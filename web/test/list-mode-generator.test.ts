import { describe, expect, test } from "bun:test";

import { parseListModeJson } from "@/pages/canvas/list-mode-generator";

describe("list mode response parsing", () => {
    test("parses plain JSON", () => {
        expect(parseListModeJson('{"columns":["卖点"],"rows":[{"卖点":"轻便"}]}')).toEqual({
            columns: ["卖点"],
            rows: [{ 卖点: "轻便" }],
        });
    });

    test("parses markdown JSON with surrounding explanation", () => {
        expect(parseListModeJson('结果如下：\n```json\n{"columns":["标题"],"rows":[{"标题":"新品"}]}\n```\n')).toEqual({
            columns: ["标题"],
            rows: [{ 标题: "新品" }],
        });
    });

    test("normalizes duplicate columns and non-string cells", () => {
        expect(parseListModeJson('{"columns":["卖点","卖点","细节"],"rows":[{"卖点":["轻","薄"],"细节":123}]}')).toEqual({
            columns: ["卖点", "细节"],
            rows: [{ 卖点: "轻、薄", 细节: "123" }],
        });
    });

    test("rejects malformed responses", () => {
        expect(parseListModeJson("模型暂时无法分析")).toBeNull();
        expect(parseListModeJson('{"columns":[],"rows":[]}')).toBeNull();
    });
});
