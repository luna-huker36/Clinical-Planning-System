const express = require("express");
const path = require("path");
const reconstructionRoutes = require("./reconstruction/routes");
const { sendError } = require("./reconstruction/errors");

const app = express();
const port = Number(process.env.PORT || 3000);
const rootDir = path.resolve(__dirname, "..");

app.use(express.json({ limit: "2mb" }));
app.use("/api/reconstruction", reconstructionRoutes);
app.use(express.static(rootDir));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "API endpoint not found." } });
    return;
  }
  res.sendFile(path.join(rootDir, "index.html"));
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  sendError(res, err);
});

app.listen(port, () => {
  console.log(`PMAS backend scaffold running at http://localhost:${port}`);
  console.log(`Backend mode: http://localhost:${port}/?reconstructionMode=backend`);
});
