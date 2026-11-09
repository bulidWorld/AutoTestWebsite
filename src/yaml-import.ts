// YAML 导入：逻辑文件名由所选文件名自动填充，去掉 .yaml/.yml 后缀。
export function logicalNameForFile(filename: string): string {
  return filename.replace(/\.ya?ml$/i, "")
}
