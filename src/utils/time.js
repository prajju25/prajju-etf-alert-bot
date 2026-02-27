function nowIST() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
}

function getISTDate() {
  return new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil3PMIST() {
  const now = new Date();

  // Convert current time to IST
  const istNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );

  const target = new Date(istNow);
  target.setHours(15, 0, 0, 0);

  if (istNow < target) {
    const diff = target - istNow;
    console.log(`Waiting ${Math.floor(diff / 1000)} seconds until 3PM IST...`);
    await sleep(diff);
  }
}

module.exports = { nowIST, getISTDate, waitUntil3PMIST };
