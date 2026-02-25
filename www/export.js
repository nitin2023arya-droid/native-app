// export.js (Modified for direct script loading and Capacitor 6)

async function exportData() {
    try {
        // 1. Direct access to the bridge (More reliable in Cap 6)
        const { Filesystem, Toast } = window.Capacitor.Plugins;

        if (!Filesystem) {
            alert("Plugin Error: Filesystem not found. Did you run 'npx cap sync'?");
            return;
        }

        // 2. Fetch data using the specific key used in your script.js
        // Based on your previous context, ensure 'Storage.KEY' is correct.
        // If Storage.KEY is 'bullion_db', use that.
        const storageKey = (typeof Storage !== 'undefined' && Storage.KEY) ? Storage.KEY : 'bullion_db';
        const data = localStorage.getItem(storageKey);

        if (!data) {
            alert('No data found in local storage to export');
            return;
        }

        // 3. Permission Handling for Android 13+ 
        // Note: 'publicStorage' is often 'granted' by default for specific app folders, 
        // but checking 'Documents' specifically is safer.
        const permStatus = await Filesystem.checkPermissions();
        if (permStatus.publicStorage !== 'granted') {
            await Filesystem.requestPermissions();
        }

        const fileName = `bullion_pro_backup_${Date.now()}.json`;

        // 4. Write the file 
        // In Cap 6, using the directory constant name as a string is preferred
        await Filesystem.writeFile({
            path: fileName,
            data: data,
            directory: 'DOCUMENTS', 
            encoding: 'utf8',
            recursive: true
        });

        // 5. Native feedback
        if (Toast) {
            await Toast.show({
                text: `Saved to Documents: ${fileName}`,
                duration: 'long'
            });
        } else {
            alert('Backup saved successfully to Documents folder');
        }

    } catch (error) {
        console.error('Export Error Detail:', error);
        alert('Export failed: ' + (error.message || 'Unknown Error'));
    }
}

// Make it globally available for the onclick in index.html
window.exportData = exportData;
