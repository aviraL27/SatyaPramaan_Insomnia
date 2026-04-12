function sanitizeUser(user) {
  if (!user) {
    return user;
  }

  const plain = typeof user.toObject === "function" ? user.toObject() : { ...user };
  delete plain.encryptedPrivateKey;

  return plain;
}

module.exports = { sanitizeUser };
