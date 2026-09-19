import { nanoid } from "nanoid";
import { message } from "antd";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasBatchTableData, type CanvasBatchRow } from "@/types/canvas";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { resolveCanvasGenerationModel } from "@/lib/canvas/canvas-project-generation";
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

function parseListModeJson(text: string): ListGenerationResult | null {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.columns) && Array.isArray(parsed.rows) && parsed.columns.length > 0) {
            return parsed as ListGenerationResult;
        }
    } catch {
        // Try removing markdown code blocks
        const cleaned = jsonMatch[0].replace(/^```json\s*/, "").replace(/\s*```$/, "");
        try {
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
                return parsed as ListGenerationResult;
            }
        } catch {
            return null;
        }
    }
    return null;
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
    const imageNodes = nodes.filter((n) => connectedImageIds.includes(n.id) && n.type === CanvasNodeType.Image && n.metadata?.content);

    if (imageNodes.length === 0) {
        message.warning("请先连接至少一张图片到当前文本节点");
        return;
    }

    setRunningNodeId(sourceNodeId);

    try {
        const model = resolveCanvasGenerationModel(config, undefined, "text");
        const listConfig = { ...config, model };

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
