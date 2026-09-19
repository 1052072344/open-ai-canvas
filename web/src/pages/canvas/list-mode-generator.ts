import { nanoid } from "nanoid";
import { message } from "antd";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasBatchTableData, type CanvasBatchRow } from "@/types/canvas";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { buildGenerationConfig, resolveCanvasGenerationModel } from "@/lib/canvas/canvas-project-generation";
import { modelCompatibilityError, modelRequestOptions, resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import type { AiConfig } from "@/stores/use-config-store";

const LIST_MODE_SYSTEM_PROMPT = `你是一个电商内容分析助手。用户会给你产品图片和一个任务描述。
请严格根据用户要求的数量生成数据；如果用户说“生成5个卖点”，就必须返回5行，每行一个独立卖点。

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
3. 用户明确要求数量时，rows 数量必须严格等于目标数量；一行只表达一个独立任务或卖点
4. 用户没有明确数量时，多张图片默认每张图片一行
5. 每个单元格内容简洁有力，适合电商/社交媒体使用
6. 不要把多个编号卖点塞进一个单元格；不要把整段分析只放进“任务提示词”
7. 列数建议 3-6 列，根据任务复杂度决定
8. 只输出 JSON，不要有任何其他文字`;

type ListGenerationResult = {
    columns: string[];
    rows: Record<string, string>[];
};

export function requestedListRowCount(prompt: string): number | undefined {
    const match = prompt.match(/(?:生成|写|列出|提供|给我|帮我)?[^\n]{0,12}?(\d+|[零〇一二两三四五六七八九十百]+)\s*(?:个|条|项|行|款|种)(?:卖点|标题|文案|内容|任务|要点)?/i);
    if (!match) return undefined;
    const value = /^\d+$/.test(match[1]) ? Number(match[1]) : chineseNumber(match[1]);
    return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : undefined;
}

function chineseNumber(value: string) {
    const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (value === "十") return 10;
    if (value.startsWith("十")) return 10 + (digits[value[1]] || 0);
    if (value.length === 2 && value[1] === "十") return (digits[value[0]] || 0) * 10;
    if (value.length === 3 && value[1] === "十") return (digits[value[0]] || 0) * 10 + (digits[value[2]] || 0);
    if (value.includes("百")) return (digits[value[0]] || 0) * 100 + (value[2] ? (digits[value[2]] || 0) * 10 : 0) + (value[3] ? digits[value[3]] || 0 : 0);
    return value.split("").reduce((total, digit) => total * 10 + (digits[digit] ?? 0), 0);
}

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

function normalizedCellKey(value: string) {
    return value.trim().toLocaleLowerCase().replace(/[\s\-_：:，,。.!！？?（）()【】\[\]]/g, "");
}

function rowCellValue(row: Record<string, string>, columnName: string, columnIndex: number) {
    if (row[columnName]) return row[columnName];
    const target = normalizedCellKey(columnName);
    const matchedKey = Object.keys(row).find((key) => normalizedCellKey(key) === target || normalizedCellKey(key).includes(target) || target.includes(normalizedCellKey(key)));
    if (matchedKey && row[matchedKey]) return row[matchedKey];
    return Object.values(row)[columnIndex] || "";
}

function splitNumberedText(value: string) {
    return value
        .split(/\n+/)
        .flatMap((line) => line.split(/(?=(?:^|\s)(?:\d{1,3}[.、)）]|[一二三四五六七八九十百]+[、.）)]))/))
        .map((item) => item.trim().replace(/^(?:\d{1,3}[.、)）]|[一二三四五六七八九十百]+[、.）)])\s*/, ""))
        .filter(Boolean);
}

function normalizeRequestedRows(parsed: ListGenerationResult, targetCount?: number) {
    if (!targetCount || parsed.rows.length >= targetCount) return targetCount ? parsed.rows.slice(0, targetCount) : parsed.rows;
    const firstColumn = parsed.columns[0];
    const expanded = parsed.rows.flatMap((row) => {
        const first = rowCellValue(row, firstColumn, 0);
        const parts = splitNumberedText(first);
        if (parts.length <= 1) return [row];
        return parts.map((part) => ({ ...row, [firstColumn]: part }));
    });
    return expanded.slice(0, targetCount);
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
        const targetRowCount = requestedListRowCount(prompt);
        // 列表模式必须沿用文本节点当前选中的模型。此前这里清空 node.metadata.model，
        // 会退回全局 textModel；当全局模型是普通文本模型时，界面虽显示 Gemini，
        // 实际请求却会发给不支持图片的旧模型。
        const requirements: ModelRequirements = {
            capability: "text",
            input: { textCount: 1, imageCount: imageNodes.length, videoCount: 0, audioCount: 0, characterCount: 0 },
            options: modelRequestOptions(config, "text"),
        };
        const preferredModel = resolveCanvasGenerationModel(config, sourceNode.metadata?.model, "text") || resolveCanvasGenerationModel(config, config.textModel, "text");
        if (!preferredModel) throw new Error("当前没有可用的文本模型，请先在模型设置中选择模型");
        const compatibleModel = resolveCompatibleModel(config, preferredModel, requirements);
        if (!compatibleModel || modelCompatibilityError(config, compatibleModel, requirements)) {
            throw new Error("当前文本模型不支持图片理解，请在节点底部选择支持图片输入的 Gemini 或其他多模态模型");
        }
        const sourceNodeForConfig = { ...sourceNode, metadata: { ...(sourceNode.metadata || {}), model: compatibleModel } };
        const listConfig = { ...buildGenerationConfig(config, sourceNodeForConfig, "text", requirements), model: compatibleModel };

        const referenceImages = imageNodes.map((node) => ({
            id: node.id,
            name: node.title || "image",
            type: "image",
            dataUrl: node.metadata?.content || "",
            storageKey: node.metadata?.storageKey,
        }));

        const fullPrompt = `${LIST_MODE_SYSTEM_PROMPT}\n\n用户任务：${prompt}\n\n图片数量：${imageNodes.length} 张\n目标行数：${targetRowCount || "未指定，按任务判断"}`;

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

        const rowsForTable = normalizeRequestedRows(parsed, targetRowCount);
        if (targetRowCount && rowsForTable.length !== targetRowCount) {
            throw new Error(`模型只返回了 ${rowsForTable.length} 行，未满足你要求的 ${targetRowCount} 行，请重试`);
        }

        // Build batch table data
        const textColumns = parsed.columns.map((name, i) => ({
            id: `ai-col-${i}`,
            label: name,
            type: "text" as const,
        }));

        const referenceColumn = { id: "ai-ref", label: "输入", type: "image" as const };

        const rows: CanvasBatchRow[] = rowsForTable.map((row, rowIndex) => {
            const imageNode = imageNodes[rowIndex % imageNodes.length];
            const cells: Record<string, string> = {};
            parsed.columns.forEach((colName, colIndex) => {
                cells[`ai-col-${colIndex}`] = rowCellValue(row, colName, colIndex);
            });
            // Build prompt from all text cells
            const cellPrompts = parsed.columns.map((colName, colIndex) => {
                const val = cells[`ai-col-${colIndex}`];
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
