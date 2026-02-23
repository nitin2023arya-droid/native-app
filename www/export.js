async function exportData() {
    const data = localStorage.getItem(Storage.KEY);

    if (!data) {
        alert('No data to export');
        return;
    }

    // Browser fallback
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'bullion_pro_backup.json';
        document.body.appendChild(a);
        a.click();

        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
    }

    // Native Android / iOS
    try {
        const Filesystem = window.Capacitor.Plugins.Filesystem;

        await Filesystem.writeFile({
            path: 'bullion_pro_backup.json',
            data: data,
            directory: 'DATA',      // safest internal directory
            encoding: 'utf8'
        });

        alert('Backup saved successfully inside app storage');

    } catch (error) {
        console.error('Export error:', error);
        alert('Failed to save backup: ' + (error?.message || error));
    }
}
