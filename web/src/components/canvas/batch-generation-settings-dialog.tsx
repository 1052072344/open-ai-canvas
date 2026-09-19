import { useEffect, useState } from "react";
import { Button, Modal } from "antd";
import { WandSparkles, X } from "lucide-react";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

export type BatchGenerationSettings = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "transparentBackground" | "count">;

type BatchGenerationSettingsDialogProps = {
    open: boolean;
    config: AiConfig;
    rowCount: number;
    concurrency: number;
    onClose: () => void;
    onConfirm: (settings: BatchGenerationSettings) => void;
};

export function BatchGenerationSettingsDialog({ open, config, rowCount, concurrency, onClose, onConfirm }: BatchGenerationSettingsDialogProps) {
    const theme = canvasThemes[useActiveTheme()];
    const [generationConfig, setGenerationConfig] = useState<AiConfig>(config);

    useEffect(() => {
        if (open) setGenerationConfig(config);
    }, [config, open]);

    const handleConfigChange = (key: "quality" | "size" | "transparentBackground" | "count", value: string) => {
        setGenerationConfig((current) => ({ ...current, [key]: value }));
    };

    const handleModelChange = (model: string) => {
        setGenerationConfig((current) => ({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model) }));
    };

    const imageModel = generationConfig.imageModel || generationConfig.model;

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            centered
            destroyOnHidden
            width={480}
            title="批量生成设置"
        >
            <div className="flex flex-col gap-4 py-2">
                <div className="rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/[0.04]">
                    共 <span className="font-semibold">{rowCount}</span> 个未完成任务 · 并发上限 <span className="font-semibold">{concurrency}</span>
                </div>

                <div className="space-y-2">
                    <div className="text-sm font-medium opacity-75">生成模型</div>
                    <ModelPicker
                        config={generationConfig}
                        value={imageModel}
                        capability="image"
                        fullWidth
                        showSelectedPrice={false}
                        onChange={handleModelChange}
                    />
                </div>

                <div className="border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                    <ImageSettingsPanel
                        config={generationConfig}
                        onConfigChange={handleConfigChange}
                        theme={theme}
                        showTitle={false}
                        showCount={true}
                        quickCount={4}
                        maxCount={10}
                        className="w-full space-y-3"
                    />
                </div>

                <div className="mt-2 flex justify-end gap-2">
                    <Button icon={<X className="size-4" />} onClick={onClose}>取消</Button>
                    <Button
                        type="primary"
                        icon={<WandSparkles className="size-4" />}
                        onClick={() => onConfirm({
                            model: generationConfig.model,
                            imageModel: generationConfig.imageModel,
                            quality: generationConfig.quality,
                            size: generationConfig.size,
                            transparentBackground: generationConfig.transparentBackground,
                            count: generationConfig.count,
                        })}
                    >
                        开始生成 {rowCount} 个任务
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
