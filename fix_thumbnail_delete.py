path = r"D:\yingce\open-ai-canvas-main\web\src\components\canvas\canvas-batch-table-node.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add onRemoveReference to Props
old_props = "    onUploadReference: (rowId: string, columnIndex: number, file: File) => void;\n    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;"
new_props = "    onUploadReference: (rowId: string, columnIndex: number, file: File) => void;\n    onRemoveReference: (rowId: string, columnIndex: number) => void;\n    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;"
content = content.replace(old_props, new_props, 1)

# 2. Add hoveredCell ref and context menu state after existing refs
old_refs = "    const dragStartRef = useRef<{ x: number; y: number; pointerId: number; cell: ReferenceCell } | null>(null);\n    const lastPointerRef = useRef({ x: 0, y: 0 });"
new_refs = """    const dragStartRef = useRef<{ x: number; y: number; pointerId: number; cell: ReferenceCell } | null>(null);
    const lastPointerRef = useRef({ x: 0, y: 0 });
    const hoveredCellRef = useRef<ReferenceCell | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cell: ReferenceCell } | null>(null);"""
content = content.replace(old_refs, new_refs, 1)

# 3. Add keyboard delete handler effect after existing useEffect block
old_effect_end = "    }, [cancelReferenceDrag, finishReferenceDrag, updateReferenceDrag]);"
new_effect_end = """    }, [cancelReferenceDrag, finishReferenceDrag, updateReferenceDrag]);

    // Delete / Backspace to remove hovered reference
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Delete" && event.key !== "Backspace") return;
            const target = event.target as HTMLElement;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            const cell = hoveredCellRef.current;
            if (!cell || readOnly) return;
            event.preventDefault();
            event.stopPropagation();
            onRemoveReference(cell.rowId, cell.columnIndex);
        };
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [readOnly, onRemoveReference]);

    // Hide context menu on outside click
    useEffect(() => {
        if (!contextMenu) return;
        const hide = () => setContextMenu(null);
        window.addEventListener("pointerdown", hide);
        return () => window.removeEventListener("pointerdown", hide);
    }, [contextMenu]);"""
content = content.replace(old_effect_end, new_effect_end, 1)

# 4. Destructure onRemoveReference
old_destructure = "onReplaceReference, onUploadReference, onConnectStart, onConnectDrop, readOnly = false"
new_destructure = "onReplaceReference, onUploadReference, onRemoveReference, onConnectStart, onConnectDrop, readOnly = false"
content = content.replace(old_destructure, new_destructure, 1)

# 5. Pass hover tracking and onRemove to ReferenceThumbnail in the rows
old_thumb = """                                    <ReferenceThumbnail
                                        key={column.id}
                                        node={nodeById.get(row.inputNodeIds[columnIndex])}
                                        theme={theme}
                                        readOnly={readOnly}
                                        rowId={row.id}
                                        columnIndex={columnIndex}
                                        columnId={column.id}
                                        draggingColumnId={draggingColumnId}
                                        isDraggingCell={draggingCell?.rowId === row.id && draggingCell.columnIndex === columnIndex}
                                        isDropTarget={dropCell?.rowId === row.id && dropCell.columnIndex === columnIndex}
                                        suppressClickRef={suppressClickRef}
                                        onReplace={onReplaceReference}
                                        onUpload={() => { uploadTargetRef.current = { rowId: row.id, columnIndex }; uploadInputRef.current?.click(); }}
                                        onPointerDown={handleReferencePointerDown}
                                        onPointerMove={handleReferencePointerMove}
                                        onPointerUp={handleReferencePointerUp}
                                        onPointerCancel={handleReferencePointerCancel}
                                        onLostPointerCapture={handleReferencePointerCancel}
                                    />"""
new_thumb = """                                    <ReferenceThumbnail
                                        key={column.id}
                                        node={nodeById.get(row.inputNodeIds[columnIndex])}
                                        theme={theme}
                                        readOnly={readOnly}
                                        rowId={row.id}
                                        columnIndex={columnIndex}
                                        columnId={column.id}
                                        draggingColumnId={draggingColumnId}
                                        isDraggingCell={draggingCell?.rowId === row.id && draggingCell.columnIndex === columnIndex}
                                        isDropTarget={dropCell?.rowId === row.id && dropCell.columnIndex === columnIndex}
                                        suppressClickRef={suppressClickRef}
                                        hoveredCellRef={hoveredCellRef}
                                        onReplace={onReplaceReference}
                                        onRemove={() => onRemoveReference(row.id, columnIndex)}
                                        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ x: event.clientX, y: event.clientY, cell: { rowId: row.id, columnIndex } }); }}
                                        onUpload={() => { uploadTargetRef.current = { rowId: row.id, columnIndex }; uploadInputRef.current?.click(); }}
                                        onPointerDown={handleReferencePointerDown}
                                        onPointerMove={handleReferencePointerMove}
                                        onPointerUp={handleReferencePointerUp}
                                        onPointerCancel={handleReferencePointerCancel}
                                        onLostPointerCapture={handleReferencePointerCancel}
                                    />"""
content = content.replace(old_thumb, new_thumb, 1)

# 6. Add context menu overlay before closing div
old_close = """            </div>
        </div>
    );
}

function ReferenceColumnHeader"""
new_close = """            </div>
            {contextMenu ? (
                <div
                    className="fixed z-50 min-w-[120px] rounded-lg border py-1 shadow-lg"
                    style={{ left: contextMenu.x, top: contextMenu.y, background: theme.node.panel, borderColor: theme.node.stroke }}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:opacity-70"
                        style={{ color: "#ef4444" }}
                        onClick={() => { onRemoveReference(contextMenu.cell.rowId, contextMenu.cell.columnIndex); setContextMenu(null); }}
                    >
                        <Trash2 className="size-3.5" />
                        删除素材
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function ReferenceColumnHeader"""
content = content.replace(old_close, new_close, 1)

# 7. Update ReferenceThumbnail props type
old_thumb_props = "    suppressClickRef: MutableRefObject<boolean>;\n    onReplace: (node: CanvasNodeData) => void;\n    onUpload: () => void;"
new_thumb_props = "    suppressClickRef: MutableRefObject<boolean>;\n    hoveredCellRef: MutableRefObject<ReferenceCell | null>;\n    onReplace: (node: CanvasNodeData) => void;\n    onRemove: () => void;\n    onContextMenu: (event: ReactMouseEvent) => void;\n    onUpload: () => void;"
content = content.replace(old_thumb_props, new_thumb_props, 1)

# 8. Update ReferenceThumbnail function signature
old_thumb_sig = "function ReferenceThumbnail({ node, theme, readOnly, rowId, columnIndex, columnId, draggingColumnId, isDraggingCell, isDropTarget, suppressClickRef, onReplace, onUpload, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture }: {"
new_thumb_sig = "function ReferenceThumbnail({ node, theme, readOnly, rowId, columnIndex, columnId, draggingColumnId, isDraggingCell, isDropTarget, suppressClickRef, hoveredCellRef, onReplace, onRemove, onContextMenu, onUpload, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture }: {"
content = content.replace(old_thumb_sig, new_thumb_sig, 1)

# 9. Add hover tracking to both thumbnail buttons (empty and filled)
# For empty button - add onMouseEnter/Leave and onContextMenu
old_empty_btn = '''                    onClick={(event) => { event.stopPropagation(); if (!suppressClickRef.current) onUpload(); }}
                    aria-label={`${columnId}，点击上传图片`}'''
new_empty_btn = '''                    onClick={(event) => { event.stopPropagation(); if (!suppressClickRef.current) onUpload(); }}
                    onMouseEnter={() => { hoveredCellRef.current = { rowId, columnIndex }; }}
                    onMouseLeave={() => { if (hoveredCellRef.current?.rowId === rowId && hoveredCellRef.current?.columnIndex === columnIndex) hoveredCellRef.current = null; }}
                    onContextMenu={onContextMenu}
                    aria-label={`${columnId}，点击上传图片`}'''
content = content.replace(old_empty_btn, new_empty_btn, 1)

# For filled button - add onMouseEnter/Leave and onContextMenu
old_filled_btn = '''                onClick={(event) => { event.stopPropagation(); if (!readOnly && !draggingColumnId && !suppressClickRef.current) onReplace(node); }}
                {...cellData}'''
new_filled_btn = '''                onClick={(event) => { event.stopPropagation(); if (!readOnly && !draggingColumnId && !suppressClickRef.current) onReplace(node); }}
                onMouseEnter={() => { hoveredCellRef.current = { rowId, columnIndex }; }}
                onMouseLeave={() => { if (hoveredCellRef.current?.rowId === rowId && hoveredCellRef.current?.columnIndex === columnIndex) hoveredCellRef.current = null; }}
                onContextMenu={onContextMenu}
                {...cellData}'''
content = content.replace(old_filled_btn, new_filled_btn, 1)

# 10. Need to import ReactMouseEvent type
old_import = 'import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";'
new_import = 'import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";'
content = content.replace(old_import, new_import, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("done")
