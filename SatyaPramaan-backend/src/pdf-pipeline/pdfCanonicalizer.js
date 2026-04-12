function sortKeysRecursively(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = sortKeysRecursively(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function normalizeText(text = "") {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

function canonicalize(value) {
  return JSON.stringify(sortKeysRecursively(value));
}

module.exports = { canonicalize, normalizeText, sortKeysRecursively };
