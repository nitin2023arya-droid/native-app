import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Toast } from '@capacitor/toast';

export async function exportData() {
    try {
        const data = localStorage.getItem(Storage.KEY);

        if (!data) {
            alert('No data to export');
            return;
        }

        const fileName = `bullion_pro_backup_${Date.now()}.json`;

        await Filesystem.writeFile({
            path: fileName,
            data: data,
            directory: Directory.Documents,
            encoding: Encoding.UTF8,
        });

        await Toast.show({
            text: 'Backup saved to Documents folder',
        });

    } catch (error) {
        console.error('Export failed:', error);
        alert('Export failed');
    }
}