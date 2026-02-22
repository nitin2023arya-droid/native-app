function exportData() { 
    const data = localStorage.getItem(Storage.KEY);

    if (!data) {
        alert('No data to export');
        return;
    }

    // Check if running inside Capacitor native app
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        // Use Capacitor Filesystem plugin to save to Downloads
        saveBackupWithCapacitor(data);
    } else {
        // Browser fallback: trigger download
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

async function saveBackupWithCapacitor(data) {
    try {
        const { Filesystem } = Capacitor.Plugins;
        // Directory and Encoding are properties of Filesystem
        const { Directory, Encoding } = Filesystem;

        await Filesystem.writeFile({
            path: 'bullion_pro_backup.json',
            data: data,
            directory: Directory.Downloads,
            encoding: Encoding.UTF8,
        });
        alert('Backup saved to Downloads folder');
    } catch (error) {
        console.error('Error saving backup:', error);
        alert('Failed to save backup: ' + error.message);
    }
}
