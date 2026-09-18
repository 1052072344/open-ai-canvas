import { configuredModelDisplayName, groupModelsByDisplayName, type DisplayModelGroup } from "@/lib/model-selection";
import { modelIcon, modelOptionName, PUBLIC_MODEL_CATALOG_ID, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export type ModelPickerGroup = {
    key: string;
    label: string;
    icon: string;
    scope: string;
    kind: "product" | "channel";
    models: DisplayModelGroup[];
};

export function isDirectSystemModel(config: AiConfig, value: string) {
    if (!value) return false;
    const channel = resolveModelChannel(config, value);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    return channel.scope === "system" && channel.id !== PUBLIC_MODEL_CATALOG_ID && !cost?.logicalModelId;
}

export function modelChannelLabel(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    return cost?.channelLabel?.trim() || channel.publicAlias?.trim() || channel.name || "未命名渠道";
}

// 只构建展示树。每个产品下的叶子仍是独立的渠道选择，不能交给模型族自动路由。
export function groupModelsForPicker(config: AiConfig, options: string[]): ModelPickerGroup[] {
    const groups = new Map<string, ModelPickerGroup>();
    for (const channel of config.channels) {
        const models = options.filter((value) => resolveModelChannel(config, value).id === channel.id);
        for (const value of models) {
            if (!isDirectSystemModel(config, value)) continue;
            const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
            const key = JSON.stringify(["product", cost?.capability, modelOptionName(value)]);
            let group = groups.get(key);
            if (!group) {
                group = { key, label: "", icon: "", scope: "平台服务", kind: "product", models: [] };
                groups.set(key, group);
            }
            group.models.push({ key: value, label: modelChannelLabel(config, value), models: [value] });
        }
        const otherModels = models.filter((value) => !isDirectSystemModel(config, value));
        if (otherModels.length) {
            const key = JSON.stringify(["channel", channel.id]);
            groups.set(key, {
                key,
                label: channel.name || "未命名渠道",
                icon: modelIcon(config, otherModels[0]),
                scope: channel.id === PUBLIC_MODEL_CATALOG_ID ? "" : "我的模型",
                kind: "channel",
                models: groupModelsByDisplayName(config, otherModels),
            });
        }
    }
    for (const group of groups.values()) {
        if (group.kind !== "product") continue;
        // 元数据按稳定身份取值，不随当前选中项或渠道排序变化；叶子顺序仍遵循后台排序。
        const members = group.models.map((item) => item.models[0]).sort();
        const named = members.find((value) => configuredModelDisplayName(config, value) !== modelOptionName(value));
        group.label = configuredModelDisplayName(config, named || members[0]);
        group.icon = members.map((value) => modelIcon(config, value)).find(Boolean) || "";
    }
    return Array.from(groups.values());
}
