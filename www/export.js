// export.js

async function exportData() {
    try {
        console.log("Export process started...");

        // 1. Access plugins via the global Capacitor object
        const Filesystem = window.Capacitor?.Plugins?.Filesystem;
        const Toast = window.Capacitor?.Plugins?.Toast;

        if (!Filesystem) {
            console.error("Filesystem plugin not found on window.Capacitor.Plugins");
            alert("Critical Error: Filesystem plugin not loaded. Ensure you ran 'npx cap sync'.");
            return;
        }

        // 2. Safely get data from localStorage
        // Using 'bullion_db' as a fallback if Storage.KEY is undefined
        const storageKey = (typeof Storage !== 'undefined' && Storage.KEY) ? Storage.KEY : 'bullion_db';
        const data = localStorage.getItem(storageKey);

        if (!data) {
            alert('No data found in local storage to export.');
            return;
        }

        // 3. Handle Android Permissions (Crucial for Capacitor 6)
        if (window.Capacitor.getPlatform() === 'android') {
            const status = await Filesystem.checkPermissions();
            if (status.publicStorage !== 'granted') {
                const request = await Filesystem.requestPermissions();
                if (request.publicStorage !== 'granted') {
                    alert('Permission denied. Cannot save file to Documents.');
                    return;
                }
            }
        }

        // 4. Define filename and write file
        const fileName = `bullion_pro_backup_${Date.now()}.json`;

        await Filesystem.writeFile({
            path: fileName,
            data: data, // Must be a string (localStorage.getItem returns a string)
            directory: 'DOCUMENTS', // Uses the DOCUMENTS folder on Android
            encoding: 'utf8',
            recursive: true
        });

        // 5. Success Feedback
        if (Toast) {
            await Toast.show({
                text: `Backup saved: ${fileName}`,
                duration: 'long'
            });
        } else {
            alert('Backup successfully saved to your Documents folder.');
        }

    } catch (error) {
        console.error('Export Error Detail:', error);
        // Providing the specific error message helps in debugging
        alert('Export failed: ' + (error.message || 'Unknown Error'));
    }
}

// Ensure the function is available to your HTML buttons
window.exportData = exportData;
