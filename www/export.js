// Ensure you have installed: npm install @capacitor/filesystem @capacitor/share
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

async function exportData() {
    const data = localStorage.getItem('YOUR_KEY');

    if (!data) {
        alert('No data to export');
        return;
    }

    if (window.Capacitor?.isNativePlatform()) {
        await saveAndShareBackup(data);
    } else {
        // Browser fallback (Your existing code works great here)
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'backup.json';
        a.click();
        URL.revokeObjectURL(url);
    }
}

async function saveAndShareBackup(data) {
    try {
        const fileName = 'bullion_pro_backup.json';
        
        // 1. Write to temporary cache directory
        const result = await Filesystem.writeFile({
            path: fileName,
            data: data,
            directory: Directory.Cache, // Cache is safer for temporary transit
            encoding: Encoding.UTF8,
        });

        // 2. Use Share Plugin so user can save to 'Files', 'Drive', or 'Downloads'
        // This bypasses many strict Android/iOS permission issues
        await Share.share({
            title: 'Export Backup',
            url: result.uri,
        });

    } catch (error) {
        console.error('Export failed', error);
        alert('Export failed: ' + error.message);
    }
}
