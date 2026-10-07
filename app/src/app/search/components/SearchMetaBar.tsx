interface SearchMetaBarProps {
  total: number
  searchTimeMs: number
  referenceImage: { id: number; title: string } | null
  truncated: boolean
}

/** 结果统计条：命中数、耗时、参考图、检索池截断提示 */
export default function SearchMetaBar({ total, searchTimeMs, referenceImage, truncated }: SearchMetaBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>
        共 <span className="font-medium text-foreground">{total}</span> 个结果
      </span>
      {searchTimeMs > 0 && <span>· 耗时 {searchTimeMs} ms</span>}
      {referenceImage && <span>· 参考图：{referenceImage.title || `#${referenceImage.id}`}</span>}
      {truncated && (
        <span className="text-amber-600">· 文件名仅检索最近 100 张图片，可能未覆盖全部结果</span>
      )}
    </div>
  )
}
