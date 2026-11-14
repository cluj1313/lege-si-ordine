const tagsMap = new Map();

export function getTags(item) {
  if (!item || !item.id) return [];
  return tagsMap.get(item.id) || [];
}

export function addTag(item, tag) {
  if (!item || !item.id || !tag) return;
  const list = getTags(item);
  if (!list.includes(tag)) list.push(tag);
  tagsMap.set(item.id, list);
}

export function removeTag(item, tag) {
  if (!item || !item.id) return;
  const list = getTags(item).filter(t => t !== tag);
  tagsMap.set(item.id, list);
}
