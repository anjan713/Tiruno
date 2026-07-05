// NotebookLM integration — shared types.
//
// NotebookLM has no official API; all operations are driven through the
// `notebooklm-mcp-cli` (https://github.com/anjan713/notebooklm-mcp-cli) over an
// authenticated Google session. These types describe the client surface and the
// per-article retention state machine (see docs/notebooklm-ingestion.md).

/** The two notebooks Tiruno maintains. */
export type NotebookKind = "courses" | "articles";

/** How a source was added to a notebook. URLs for clean public pages; files for
 *  emails/newsletters and paywalled/JS-heavy pages (which we convert first). */
export type SourceKind = "url" | "file";

/** Assets generated from a grounded source. */
export type AssetKind = "podcast" | "lesson" | "mcq";

/** Per-article lifecycle: discovered → ingested → assets → engaged → retained → removed. */
export type ArticleNotebookStatus =
  | "discovered"
  | "ingested"
  | "assets"
  | "engaged"
  | "retained"
  | "removed"
  | "error";

export interface SourceInfo {
  id: string;
  title?: string;
  active?: boolean;
  kind?: SourceKind;
  url?: string;
}

export interface AudioOverview {
  /** Location of the generated audio overview (local path or URL). */
  audioUrl: string;
  status: string;
}

export interface AssetRef {
  kind: AssetKind;
  /** Reference id into another store (e.g. a generated lesson id). */
  refId?: string;
  /** Location of the asset (e.g. podcast audio url/path). */
  url?: string;
  at: number;
}

/** Redis-persisted state for one article's life in the Articles notebook. */
export interface ArticleNotebookState {
  articleId: string;
  notebook: NotebookKind;
  sourceId?: string;
  sourceKind?: SourceKind;
  url?: string;
  status: ArticleNotebookStatus;
  active: boolean;
  assets: AssetRef[];
  /** Engagement / quiz score 0..100 — drives retention. */
  score: number;
  addedAt: number;
  expiresAt: number;
  updatedAt: number;
}
