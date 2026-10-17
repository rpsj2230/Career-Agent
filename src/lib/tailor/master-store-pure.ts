/** The master resume must be a PDF or a Word (.docx) file. */
export const masterExt = (name: string): "pdf" | "docx" | null => (name.toLowerCase().match(/\.(pdf|docx)$/)?.[1] as "pdf" | "docx" | undefined) ?? null;
