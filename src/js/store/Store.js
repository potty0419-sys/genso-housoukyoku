// 保存先を差し替えるための非同期インターフェース。
export class Store {
  async list(_filters = {}) { throw new Error('list の実装が必要です'); }
  async create(_data) { throw new Error('create の実装が必要です'); }
  async update(_id, _changes, _deleteKey) { throw new Error('update の実装が必要です'); }
  async remove(_id, _deleteKey) { throw new Error('remove の実装が必要です'); }
  async report(_id) { throw new Error('report の実装が必要です'); }
  async interest(_id) { throw new Error('interest の実装が必要です'); }
}
