export function downloadBatchJobs(
  jobIds: string[],
  subscriptionId: number,
  fields: string[],
  divider: string,
  uppercase: boolean,
  splitter: boolean,
) {
  const fieldsString = fields.length === 0 ? "none" : fields.join(",");

  return fetch("/api/jobs/download/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobIds,
      subscriptionId,
      fields: fieldsString,
      delimiter: divider,
      uppercase,
      splitter,
    }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);

        if (response.status === 403) {
          return {
            success: false,
            message:
              errorData?.message || "Download is not available for this plan.",
          };
        }

        throw new Error(errorData?.message || response.statusText);
      }

      const csvContent = await response.text();
      const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8;",
      });

      const downloadLink = document.createElement("a");
      downloadLink.href = window.URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadLink.setAttribute("download", `batch-${timestamp}.csv`);
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      return { success: true, message: "Download successful." };
    })
    .catch((error) => {
      console.error("Error downloading batch CSV:", error);
      return { success: false, message: "Download failed." };
    });
}

export function downloadJob(
  jobid: string,
  subscriptionId: number,
  fields: string[],
  divider: string,
  uppercase: boolean,
  splitter: boolean,
) {
  const fieldsString = fields.length === 0 ? "none" : fields.join(",");

  return fetch(
    `/api/jobs/download/${jobid}/${subscriptionId}?f=${fieldsString}&d=${divider}&u=${uppercase}&s=${splitter}`,
  )
    .then(async (response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);

        if (response.status === 403) {
          return {
            success: false,
            message: errorData?.message || "Download is not available for this plan.",
          };
        }

        throw new Error(errorData?.message || response.statusText);
      }

      const csvContent = await response.text();
      const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8;",
      });

      const downloadLink = document.createElement("a");
      downloadLink.href = window.URL.createObjectURL(blob);
      downloadLink.setAttribute("download", `${jobid}.csv`);
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      return { success: true, message: "Download successful." };
    })
    .catch((error) => {
      console.error("Error downloading the job CSV:", error);
      return { success: false, message: "Download failed." };
    });
}
