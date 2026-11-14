const tagsMap = new Map();

export function getTags(item) {
  return tagsMap.get(item.id) || [];
}

export function addTag(item, tag) {
  const list = getTags(item);
  if (!list.includes(tag)) list.push(tag);
  tagsMap.set(item.id, list);
}

export function removeTag(item, tag) {
  const list = getTags(item).filter(t => t !== tag);
  tagsMap.set(item.id, list);
}
