function mapChangedWordsToRectangles(changedWords = []) {
  return changedWords.reduce((accumulator, word) => {
    const page = String(word.pageNumber);

    if (!accumulator[page]) {
      accumulator[page] = [];
    }

    accumulator[page].push({
      x: word.x,
      y: word.y,
      width: word.width,
      height: word.height,
      text: word.text
    });

    return accumulator;
  }, {});
}

module.exports = { mapChangedWordsToRectangles };
