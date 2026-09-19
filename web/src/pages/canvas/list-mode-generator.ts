import { nanoid } from "nanoid";
import { message } from "antd";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasBatchTableData, type CanvasBatchRow } from "@/types/canvas";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { modelRequestOptions, type ModelRequirements } from "@/lib/model-selection";
import type { AiConfig } from "@/stores/use-config-store";

const LIST_MODE_SYSTEM_PROMPT = `你是一个电商内容分析助手。用户会给你多张产品图片和一个任务描述。
请分析每张图片，为每张图片生成一行数据。

输出严格为以下 JSON 格式（不要输出其他内容）：
{
  "columns": ["列名1", "列名2", "列名3"],
  "rows": [
    {"列名1": "内容", "列名2": "内容", "列名3": "内容"}
  ]
}

规则：
1. 第一列不需要输出（它是图片本身），从第二列开始定义分析维度
2. 列名根据任务需求自动决定（如：核心卖点、视觉细节、文案标题、搭配建议等）
3. 每张图片对应一行，rows 数量等于图片数量
4. 每个单元格内容简洁有力，适合电商/社交媒体使用
5. 列数建议 3-6 列，根据任务复杂度决定
6. 只输出 JSON，不要有任何其他文字`;

type ListGenerationResult = {
    columns: string[];
    rows: Record<string, string>[];
};

export function parseListModeJson(text: string): ListGenerationResult | null {
    const candidates = [
        text.trim(),
        ...Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi), (match) => match[1].trim()),
        ...balancedJsonObjects(text),
    ];
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as { columns?: unknown; rows?: unknown };
            const columns = normalizeListColumns(parsed.columns);
            if (!columns.length || !Array.isArray(parsed.rows)) continue;
            const rows = parsed.rows
                .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
                .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, listCellText(value)])));
            return { columns, rows };
        } catch {
            // Try the next candidate. Models often wrap valid JSON in prose or a code block.
        }
    }
    return null;
}

function balancedJsonObjects(text: string) {
    const results: string[] = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === "{") {
            if (depth === 0) start = index;
            depth += 1;
        } else if (char === "}" && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                results.push(text.slice(start, index + 1));
                start = -1;
            }
        }
    }
    return results;
}

function normalizeListColumns(value: unknown) {
    if (!Array.isArray(value)) return [];
    const used = new Set<string>();
    return value.flatMap((item) => {
        const label = typeof item === "string" ? item.trim() : "";
        if (!label || used.has(label)) return [];
        used.add(label);
        return [label];
    });
}

function listCellText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.map(listCellText).filter(Boolean).join("、");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

type HandleListGenerateOptions = {
    sourceNodeId: string;
    prompt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    config: AiConfig;
    projectId: string;
    setNodes: (updater: (prev: CanvasNodeData[]) => CanvasNodeData[]) => void;
    setConnections: (updater: (prev: CanvasConnection[]) => CanvasConnection[]) => void;
    setRunningNodeId: (id: string | null) => void;
    setDialogNodeId: (id: string | null) => void;
};

export async function handleListGenerate({
    sourceNodeId,
    prompt,
    nodes,
    connections,
    config,
    projectId,
    setNodes,
    setConnections,
    setRunningNodeId,
    setDialogNodeId,
}: HandleListGenerateOptions) {
    const sourceNode = nodes.find((n) => n.id === sourceNodeId);
    if (!sourceNode) return;

    // Find connected image nodes
    const connectedImageIds = connections
        .filter((c) => c.toNodeId === sourceNodeId && c.fromNodeId !== sourceNodeId)
        .map((c) => c.fromNodeId);
    const imageNodes = nodes.filter((n) => connectedImageIds.includes(n.id) && n.type === CanvasNodeType.Image && Boolean(n.metadata?.content || n.metadata?.storageKey));

    if (imageNodes.length === 0) {
        message.warning("请先连接至少一张图片到当前文本节点");
        return;
    }

    setRunningNodeId(sourceNodeId);

    try {
        // Ask model selection for a text model that can receive all connected images.
        const sourceNodeForConfig = { ...sourceNode, metadata: { ...(sourceNode.metadata || {}), model: undefined } };
        const requirements: ModelRequirements = {
            capability: "text",
            input: { textCount: 1, imageCount: imageNodes.length, videoCount: 0, audioCount: 0, characterCount: 0 },
            options: modelRequestOptions(config, "text"),
        };
        const listConfig = buildGenerationConfig(config, sourceNodeForConfig, "text", requirements);

        const referenceImages = imageNodes.map((node) => ({
            id: node.id,
            name: node.title || "image",
            type: "image",
            dataUrl: node.metadata?.content || "",
            storageKey: node.metadata?.storageKey,
        }));

        const fullPrompt = `${LIST_MODE_SYSTEM_PROMPT}\n\n用户任务：${prompt}\n\n图片数量：${imageNodes.length} 张`;

        const result = await runBackendGenerationTask({
            projectId,
            mode: "text",
            prompt: fullPrompt,
            config: listConfig,
            referenceImages,
            streamText: false,
        });

        const text = result.text || "";
        const parsed = parseListModeJson(text);

        if (!parsed) {
            message.error("AI 返回格式异常，请重试");
            return;
        }

        // Build batch table data
        const textColumns = parsed.columns.map((name, i) => ({
            id: `ai-col-${i}`,
            label: name,
            type: "text" as const,
        }));

        const referenceColumn = { id: "ai-ref", label: "输入", type: "image" as const };

        const rows: CanvasBatchRow[] = parsed.rows.map((row, rowIndex) => {
            const imageNode = imageNodes[rowIndex % imageNodes.length];
            const cells: Record<string, string> = {};
            parsed.columns.forEach((colName, colIndex) => {
                cells[`ai-col-${colIndex}`] = row[colName] || "";
            });
            // Build prompt from all text cells
            const cellPrompts = parsed.columns.map((colName, colIndex) => {
                const val = row[colName] || "";
                return val ? `${colName}：${val}` : "";
            }).filter(Boolean);

            return {
                id: `batch-row-${nanoid()}`,
                enabled: true,
                inputNodeIds: imageNode ? [imageNode.id] : [],
                prompt: cellPrompts.join("\n"),
                cells,
            };
        });

        const batchTable: CanvasBatchTableData = {
            operation: "creative",
            concurrency: 10,
            aiGenerated: true,
            referenceColumns: [referenceColumn],
            textColumns,
            rows,
        };

        // Create the batch table node
        const sourcePos = sourceNode.position;
        const batchNodeId = `batch-table-${nanoid()}`;
        const batchNode: CanvasNodeData = {
            id: batchNodeId,
            type: CanvasNodeType.BatchTable,
            title: "AI 多维表格",
            position: { x: sourcePos.x + 400, y: sourcePos.y },
            width: 900,
            height: 400,
            metadata: {
                batchTable,
                model: listConfig.model,
                status: "idle",
            },
        };

        // Create connections from each image node to the batch table's reference handle
        const newConnections: CanvasConnection[] = imageNodes.map((imgNode) => ({
            id: `conn-${nanoid()}`,
            fromNodeId: imgNode.id,
            fromHandleId: "output",
            toNodeId: batchNodeId,
            toHandleId: "batch-reference:ai-ref",
            relation: "batch-input",
        }));

        setNodes((prev) => [...prev, batchNode]);
        setConnections((prev) => [...prev, ...newConnections]);
        setDialogNodeId(batchNodeId);

        message.success(`已生成多维表格：${parsed.columns.length} 列 × ${rows.length} 行`);
    } catch (err) {
        message.error(err instanceof Error ? err.message : "列表生成失败");
    } finally {
        setRunningNodeId(null);
    }
}
