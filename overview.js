import { connectOrdersRefresh, createPanel, loadCachedOrders } from "./lib/panel.js";

const panel = createPanel(document.getElementById("app"), {
  onRefresh: ({ force }) => runRefresh({ force }),
});

function runRefresh({ force = false } = {}) {
  panel.setError("");
  panel.setRefreshing(true);

  const client = connectOrdersRefresh({
    onProgress: (progress) => panel.setProgress(progress),
    onDone: (payload) => {
      panel.applyPayload(payload);
      panel.hideProgress();
      panel.setRefreshing(false);
    },
    onError: (message) => {
      if (message.code === "AUTH") {
        panel.setStatus("Not logged in");
        panel.setError("Log in at ascension.gg in this browser, then refresh.");
      } else if (message.status === 401 || message.status === 403) {
        panel.setError("Auth failed — log in at ascension.gg and refresh.");
        panel.setStatus("Error");
      } else {
        panel.setError(`Failed to load: ${message.error}`);
        panel.setStatus("Error");
      }
      panel.hideProgress();
      panel.setRefreshing(false);
    },
  });

  panel.showProgress();
  panel.setStatus(force ? "Fetching order history…" : "Loading…");
  client.refresh(force);
}

loadCachedOrders().then((cached) => {
  if (cached) panel.applyPayload(cached);
  runRefresh();
});
