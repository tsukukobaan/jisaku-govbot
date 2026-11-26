// wrangler.jsonc に書かない変数（worker-configuration.d.ts の Env に足す）
interface Env {
  /** "1" のときだけ /embed とモデルの差し替えを許す。手元は .dev.vars で "1"、公開側は wrangler.jsonc の vars で "0" */
  LOCAL_EVAL?: string;
  /** IP のハッシュに混ぜる秘密の塩。`wrangler secret put IP_SALT`（無くても動く） */
  IP_SALT?: string;
  /** 1日（UTC）の neurons の上限（wrangler.jsonc の vars） */
  DAILY_NEURONS?: string;
  /** 1日（UTC）に受ける質問数の上限（wrangler.jsonc の vars） */
  DAILY_ASKS?: string;
  /** 上限の通知：LINE Messaging API のチャネルアクセストークン（Secret） */
  LINE_CHANNEL_TOKEN?: string;
  /** 上限の通知：受け取る人の LINE ユーザー ID（Secret） */
  LINE_TO?: string;
}
