function nowIST() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
}

function getISTDate() {
  return new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
}

module.exports = { nowIST, getISTDate };
