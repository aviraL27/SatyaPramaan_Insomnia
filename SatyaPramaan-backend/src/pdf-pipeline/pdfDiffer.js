const { diffWordsWithSpace } = require("diff");

function diffTokenStreams(originalText, candidateText) {
  return diffWordsWithSpace(originalText, candidateText);
}

module.exports = { diffTokenStreams };
