import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

async function exportData() {
    const data = localStorage.getItem(Storage.KEY);

    if (!data) {
        alert('No data to export');
        return;
    }

    // If running inside native app
    if (Capacitor.isNativePlatform()) {
        await saveBackupWithCapacitor(data);
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

async function saveBackupWithCapacitor(data) {
    try {
        // Request permission (important for Android 11+)
        const permission = await Filesystem.requestPermissions();

        if (permission.publicStorage !== 'granted') {
            alert('Storage permission denied');
            return;
        }

        await Filesystem.writeFile({
            path: 'bullion_pro_backup.json',
            data: data,
            directory: Directory.Documents,  // More reliable than Downloads
            encoding: Encoding.UTF8,
        });

        const uri = await Filesystem.getUri({
            directory: Directory.Documents,
            path: 'bullion_pro_backup.json'
        });

        console.log('Backup saved at:', uri.uri);

        alert('Backup saved successfully');

    } catch (error) {
        console.error('Export error:', error);
        alert('Failed to save backup: ' + error.message);
    }
}

export { exportData };
