// export.js

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function exportData() {
  try {
    const data = localStorage.getItem(Storage.KEY);

    if (!data) {
      alert('No data to export');
      return;
    }

    // Write backup file to Android's Documents directory
    await Filesystem.writeFile({
      path: 'bullion_pro_backup.json',
      data: data,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });

    // Share the file (optional)
    await Share.share({
      title: 'Backup Export',
      text: 'Here is your backup file',
      url: 'bullion_pro_backup.json',
      dialogTitle: 'Share backup with',
    });

    alert('Backup exported successfully!');
  } catch (err) {
    console.error('Export failed', err);
    alert('Export failed: ' + err.message);
  }
}