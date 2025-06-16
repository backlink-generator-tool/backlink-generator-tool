 function isValidUrl(string) {
      try {
        const url = new URL(string);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    }

    function updateWebsiteScreenshot(url) {
      const preview = document.getElementById("previewwebsite");
      if (isValidUrl(url)) {
        // Using width 800px, cropped height 400px for demo
        preview.src = `https://image.thum.io/get/width/800/crop/400/${decodeURIComponent(url)}`;
        preview.style.display = "block";
      } else {
        preview.src = "";
        preview.style.display = "none";
      }
    }

    window.addEventListener("DOMContentLoaded", () => {
      const params = new URLSearchParams(window.location.search);
      let foundUrl = null;
      for (const key of params.keys()) {
        if (isValidUrl(key)) { foundUrl = key; break; }
        const decoded = decodeURIComponent(key);
        if (isValidUrl(decoded)) { foundUrl = decoded; break; }
      }
      if (foundUrl) {
        const input = document.getElementById("urlInput");
        input.value = foundUrl;
        updateWebsiteScreenshot(foundUrl);
      }
    });

    document.getElementById("urlInput").addEventListener("input", (e) => {
      updateWebsiteScreenshot(e.target.value.trim());
    });

    // Update concurrent count display
    document.getElementById("concurrencyRange").addEventListener("input", (e) => {
      document.getElementById("concurrentCount").textContent = e.target.value;
    });
