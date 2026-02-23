async function exportData() {
    // 1. Get the data (Ensure your key matches exactly what you use in script.js)
    const data = localStorage.getItem('YOUR_STORAGE_KEY'); 

    if (!data) {
        alert('No data to export');
        return;
    }

    // 2. Check if running on Android/iOS via Capacitor
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        await saveAndShareBackup(data);
    } else {
        // Browser fallback
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bullion_pro_backup.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

async function saveAndShareBackup(data) {
    try {
        // Access plugins via the global Capacitor object
        const { Filesystem } = Capacitor.Plugins;
        const { Share } = Capacitor.Plugins;

        if (!Filesystem || !Share) {
            throw new Error("Capacitor plugins not found. Did you run 'npx cap sync'?");
        }

        const fileName = 'bullion_pro_backup.json';
        
        // Write to temporary cache
        const result = await Filesystem.writeFile({
            path: fileName,
            data: data,
            directory: 'CACHE', // Use string constant for global access
            encoding: 'utf8',
        });

        // Open Share sheet
        await Share.share({
            title: 'Bullion Plus Backup',
            url: result.uri,
        });

    } catch (error) {
        console.error('Export failed:', error);
        alert('Export error: ' + error.message);
    }
}
