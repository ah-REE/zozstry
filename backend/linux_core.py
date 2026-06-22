import subprocess
import json
import sys
import os
import time
import hashlib
import shutil

ipc_socket = None

def set_ipc_socket(sock):
    global ipc_socket
    ipc_socket = sock

CANCEL_FLAG = os.path.join('/tmp', 'zozstry_cancel.flag')

def emit(data):
    payload = json.dumps(data)
    if ipc_socket:
        try:
            ipc_socket.sendall((payload + "\n").encode('utf-8'))
        except:
            pass
    else:
        print(payload)
        sys.stdout.flush()

def check_cancel():
    if os.path.exists(CANCEL_FLAG):
        raise Exception("Process aborted by user. Drive may be in an incomplete state.")

def get_usb_drives():
    try:
        result = subprocess.run(["lsblk", "-J", "-d", "-o", "NAME,MODEL,SIZE,TRAN"], capture_output=True, text=True)
        if result.returncode != 0:
            return []
        
        data = json.loads(result.stdout)
        drives = []
        
        for dev in data.get("blockdevices", []):
            if dev.get("tran") == "usb":
                drives.append({
                    "device_id": f"/dev/{dev.get('name')}",
                    "label": str(dev.get("model")).strip() or "USB Drive",
                    "size": str(dev.get("size")).strip()
                })
        return drives
    except Exception as e:
        return [{"error": str(e)}]

def verify_safety(device_id):
    result = subprocess.run(["lsblk", "-n", "-d", "-o", "TRAN", device_id], capture_output=True, text=True)
    if "usb" not in result.stdout.lower():
        raise Exception(f"SAFETY ABORT: Target {device_id} is not a USB device.")

def restore_drive(device_id):
    try:
        verify_safety(device_id)
        emit({"progress": 0, "status": "Dropping volume locks natively..."})
        subprocess.run(f"umount {device_id}*", shell=True, stderr=subprocess.DEVNULL)
        time.sleep(1)

        emit({"progress": 20, "status": "Executing raw hardware wipe..."})
        subprocess.run(["wipefs", "-a", device_id], check=True)

        emit({"progress": 55, "status": "Ghost-formatting natively..."})
        subprocess.run(["parted", "-s", device_id, "mklabel", "msdos"], check=True)
        subprocess.run(["parted", "-s", device_id, "mkpart", "primary", "fat32", "1MiB", "100%"], check=True)
        
        time.sleep(2)
        part_id = f"{device_id}1"
        
        emit({"progress": 85, "status": "Building FAT32 Filesystem..."})
        subprocess.run(["mkfs.vfat", "-F", "32", "-n", "ZOZSTRY", part_id], check=True)

        emit({"progress": 100, "status": f"Restore complete! Drive {device_id} is ready."})

    except Exception as e:
        emit({"error": f"Restore failed: {str(e)}"})

def flash_linux_dd(device_id, file_path, verify=False):
    try:
        emit({"progress": 1, "status": "Dropping volume locks natively..."})
        subprocess.run(f"umount {device_id}*", shell=True, stderr=subprocess.DEVNULL)
        subprocess.run(["wipefs", "-a", device_id], check=True)
        time.sleep(1.5)

        total_bytes_to_write = os.path.getsize(file_path)
        bytes_done = 0
        chunk_size = 1024 * 1024 * 16

        emit({"progress": 2, "status": "Initializing synchronous direct-to-metal stream..."})

        SECTOR_SIZE = 4096
        start_time = time.time()
        last_reported = -1

        flags = os.O_RDWR | os.O_SYNC
        fd_raw = os.open(device_id, flags)

        with open(file_path, "rb") as fd_in, open(fd_raw, "rb+", buffering=0, closefd=True) as fd_out:
            while True:
                check_cancel()
                chunk = fd_in.read(chunk_size)
                if not chunk: break

                remainder = len(chunk) % SECTOR_SIZE
                if remainder > 0:
                    chunk += b'\x00' * (SECTOR_SIZE - remainder)

                fd_out.write(chunk)
                bytes_done += len(chunk)
                
                elapsed = time.time() - start_time
                speed = (bytes_done / 1048576) / max(0.001, elapsed)
                progress = 2 + int((bytes_done / total_bytes_to_write) * 96)

                if progress != last_reported:
                    last_reported = progress
                    emit({"progress": min(98, progress), "status": f"Writing... {progress}% @ {speed:.2f} MB/s"})

        subprocess.run(["sync"], check=True)

        if verify:
            emit({"progress": 99, "status": "Verifying data integrity..."})
            source_hash = hashlib.sha256()
            with open(file_path, "rb") as f:
                while v_chunk := f.read(chunk_size): 
                    check_cancel()
                    source_hash.update(v_chunk)
            
            usb_hash = hashlib.sha256()
            with open(device_id, "rb") as fd_read:
                bytes_read = 0
                while bytes_read < total_bytes_to_write:
                    check_cancel()
                    read_size = min(chunk_size, total_bytes_to_write - bytes_read)
                    v_chunk = fd_read.read(read_size)
                    if not v_chunk: break
                    usb_hash.update(v_chunk)
                    bytes_read += len(v_chunk)

            if source_hash.hexdigest() != usb_hash.hexdigest():
                raise Exception("Verification failed: Data integrity error.")

        emit({"progress": 100, "status": "Deployment Successful. Safe to eject hardware."})

    except Exception as e:
        emit({"error": f"Deployment failed: {str(e)}"})

def flash_windows_inverted_phantom(device_id, file_path, verify=False, force_gpt=False):
    iso_mounted = False
    iso_mount_path = "/tmp/zoz_iso"
    try:
        partition_style = "gpt" if force_gpt else "msdos"
        
        emit({"progress": 1, "status": "Mounting Windows ISO via Linux Loopback..."})
        os.makedirs(iso_mount_path, exist_ok=True)
        subprocess.run(["mount", "-o", "loop,ro", file_path, iso_mount_path], check=True, stderr=subprocess.DEVNULL)
        iso_mounted = True

        emit({"progress": 5, "status": "Structuring Inverted Phantom Layout..."})
        subprocess.run(f"umount {device_id}*", shell=True, stderr=subprocess.DEVNULL)
        subprocess.run(["wipefs", "-a", device_id], check=True)
        
        subprocess.run(["parted", "-s", device_id, "mklabel", partition_style], check=True)
        
        size_res = subprocess.run(["blockdev", "--getsize64", device_id], capture_output=True, text=True, check=True)
        total_bytes = int(size_res.stdout.strip())
        data_size_mb = (total_bytes // (1024 * 1024)) - 1500
        
        if data_size_mb < 1000:
            raise Exception("USB Drive capacity is too low to support Dual-Partition routing.")

        subprocess.run(["parted", "-s", device_id, "mkpart", "primary", "ntfs", "1MiB", f"{data_size_mb}MiB"], check=True)
        subprocess.run(["parted", "-s", device_id, "mkpart", "primary", "fat32", f"{data_size_mb}MiB", "100%"], check=True)
        
        if partition_style == "msdos":
            subprocess.run(["parted", "-s", device_id, "set", "2", "boot", "on"], check=True)
            
        time.sleep(2)
        
        emit({"progress": 8, "status": "Building Native Linux Filesystems..."})
        subprocess.run(["mkfs.ntfs", "-Q", "-L", "ZOZ_DATA", f"{device_id}1"], check=True)
        subprocess.run(["mkfs.vfat", "-F", "32", "-n", "ZOZ_BOOT", f"{device_id}2"], check=True)

        data_mount = "/tmp/zoz_data"
        boot_mount = "/tmp/zoz_boot"
        os.makedirs(data_mount, exist_ok=True)
        os.makedirs(boot_mount, exist_ok=True)
        
        try:
            subprocess.run(["mount", "-t", "ntfs3", f"{device_id}1", data_mount], check=True, stderr=subprocess.DEVNULL)
        except:
            subprocess.run(["mount", "-t", "ntfs-3g", "-o", "big_writes", f"{device_id}1", data_mount], check=True)
            
        subprocess.run(["mount", f"{device_id}2", boot_mount], check=True)

        emit({"progress": 10, "status": "Calculating Phantom routes..."})
        
        files_to_copy = []
        total_copy_bytes = 0
        
        for root, dirs, files in os.walk(iso_mount_path):
            for f in files:
                src_path = os.path.join(root, f)
                rel_path = os.path.relpath(src_path, iso_mount_path)
                rel_lower = rel_path.lower()
                size = os.path.getsize(src_path)
                
                dest_data = os.path.join(data_mount, rel_path)
                files_to_copy.append((src_path, dest_data, size))
                total_copy_bytes += size

                is_boot_critical = (
                    rel_lower.startswith("efi/") or 
                    rel_lower.startswith("boot/") or 
                    rel_lower == "bootmgr" or 
                    rel_lower == "bootmgr.efi" or 
                    rel_lower == "sources/boot.wim"
                )
                
                if is_boot_critical:
                    dest_boot = os.path.join(boot_mount, rel_path)
                    files_to_copy.append((src_path, dest_boot, size))
                    total_copy_bytes += size

        copied_bytes = 0
        start_time = time.time()
        last_reported = -1
        last_emit_time = 0 
        smoothed_speed = 0  
        
        for src, dest, size in files_to_copy:
            target_dir = os.path.dirname(dest)
            if target_dir and not os.path.exists(target_dir):
                os.makedirs(target_dir, exist_ok=True)
            
            if size < 10 * 1024 * 1024:
                shutil.copyfile(src, dest)
                copied_bytes += size
                
                current_time = time.time()
                elapsed = current_time - start_time
                if (current_time - last_emit_time) > 0.1:
                    last_emit_time = current_time
                    
                    raw_speed = (copied_bytes / 1048576) / max(0.001, elapsed)
                    smoothed_speed = (smoothed_speed * 0.9) + (raw_speed * 0.1) if smoothed_speed > 0 else raw_speed
                    progress = 10 + int((copied_bytes / total_copy_bytes) * 88) 
                    
                    if progress != last_reported:
                        last_reported = progress
                        emit({"progress": min(98, progress), "status": f"Tunneling payload... {progress}% @ {smoothed_speed:.2f} MB/s"})
            else:
                with open(src, 'rb') as fsrc, open(dest, 'wb') as fdst:
                    while True:
                        check_cancel()
                        chunk = fsrc.read(1024 * 1024 * 16) 
                        if not chunk: break
                        fdst.write(chunk)
                        
                        # THE FIX: Force physical hardware write instantly, neutralizing OS RAM Cache
                        fdst.flush()
                        os.fsync(fdst.fileno())
                        
                        copied_bytes += len(chunk)
                        
                        current_time = time.time()
                        elapsed = current_time - start_time
                        
                        if (current_time - last_emit_time) > 0.1:
                            last_emit_time = current_time
                            
                            raw_speed = (copied_bytes / 1048576) / max(0.001, elapsed)
                            smoothed_speed = (smoothed_speed * 0.9) + (raw_speed * 0.1) if smoothed_speed > 0 else raw_speed
                            progress = 10 + int((copied_bytes / total_copy_bytes) * 88) 
                            
                            if progress != last_reported:
                                last_reported = progress
                                emit({"progress": min(98, progress), "status": f"Tunneling payload... {progress}% @ {smoothed_speed:.2f} MB/s"})

        subprocess.run(["sync"], check=True)
        subprocess.run(["umount", data_mount], check=True)
        subprocess.run(["umount", boot_mount], check=True)

        emit({"progress": 100, "status": "Deployment Successful. Safe to eject hardware."})

    except Exception as e:
        emit({"error": f"Deployment failed: {str(e)}"})
        subprocess.run(f"umount {device_id}*", shell=True, stderr=subprocess.DEVNULL)
    finally:
        if iso_mounted:
            subprocess.run(["umount", iso_mount_path], stderr=subprocess.DEVNULL)
            
def flash_drive(device_id, file_path, verify=False, force_gpt=False, persistent_mb=0):
    if os.path.exists(CANCEL_FLAG):
        try: os.remove(CANCEL_FLAG)
        except: pass

    try:
        verify_safety(device_id)
        
        emit({"progress": 0, "status": "Interrogating ISO payload..."})
        iso_mount_path = "/tmp/zoz_check"
        os.makedirs(iso_mount_path, exist_ok=True)
        
        os_type = "LINUX"
        try:
            subprocess.run(["mount", "-o", "loop,ro", file_path, iso_mount_path], check=True, stderr=subprocess.DEVNULL)
            has_bootmgr = os.path.exists(os.path.join(iso_mount_path, "bootmgr"))
            has_bootwim = os.path.exists(os.path.join(iso_mount_path, "sources", "boot.wim"))
            
            if has_bootmgr or has_bootwim:
                os_type = "WINDOWS"
                
            subprocess.run(["umount", iso_mount_path], check=True)
        except:
            pass 

        if os_type == "WINDOWS":
            emit({"progress": 0, "status": "Windows OS detected. Initializing Inverted Phantom Router..."})
            flash_windows_inverted_phantom(device_id, file_path, verify, force_gpt)
        else:
            emit({"progress": 0, "status": "Linux OS detected. Initializing Direct Block Writer..."})
            flash_linux_dd(device_id, file_path, verify)

    except Exception as e:
        emit({"error": f"Flashing failed: {str(e)}"})