/*
本番用の接続設計メモのみ。このファイルは import しない。外部通信・接続は行わない。
SDKや秘密鍵をこの静的サイトに埋め込まないこと。

import { Store } from './Store.js';
export class SupabaseStore extends Store {
  // fetch は本番でのみ導入。公開一覧は RLS + 期限/通報フィルターで取得する。
  async list(filters) { // GET 公開ビュー。型に応じて filters を検証する }
  async create(data) { // Edge Function: サーバー検証 → レート/重複検査 → キー発行 }
  async update(id, changes, deleteKey) { // 所有確認をサーバーで行う }
  async remove(id, deleteKey) { // 削除キーのハッシュをサーバーで照合する }
  async report(id) { // 匿名認証IDで重複排除し、トランザクションで通報を記録 }
  async interest(id) { // 一意な匿名認証IDで1件だけ加算 }
}

docs/board_operation.md と docs/supabase_schema.sql を参照。
LocalStore の制限はクライアント内の試作であり、本番の安全策としては使わない。
*/
