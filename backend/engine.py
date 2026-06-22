import sys
import os
import socket
import json
import subprocess

def is_admin_linux():
    return os.geteuid() == 0

def is_admin_windows():
    import ctypes
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

if __name__ == "__main__":
    # IPC Socket setup for Tauri communication
    ipc_socket = None
    if "--ipc" in sys.argv:
        idx = sys.argv.index("--ipc")
        port = int(sys.argv[idx + 1])
        sys.argv.pop(idx)
        sys.argv.pop(idx)
        
        ipc_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        ipc_socket.connect(("127.0.0.1", port))

    command = sys.argv[1] if len(sys.argv) > 1 else None

    # Determine current operating system
    is_linux = sys.platform.startswith("linux")

    if command in ["--flash", "--restore"]:
        
        # --- PRIVILEGE ESCALATION ROUTER ---
        if is_linux and not is_admin_linux():
            # Trigger Fedora/Linux GUI password prompt using pkexec
            server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            server.bind(("127.0.0.1", 0))
            server.listen(1)
            bridge_port = server.getsockname()[1]
            
            params = ['--ipc', str(bridge_port)] + sys.argv[1:]
            
            if getattr(sys, 'frozen', False):
                exe_path = sys.executable
                cmd_list = ["pkexec", exe_path] + params
            else:
                script = os.path.abspath(sys.argv[0])
                exe_path = sys.executable
                cmd_list = ["pkexec", exe_path, script] + params

            try:
                subprocess.Popen(cmd_list)
            except Exception as e:
                print(json.dumps({"error": f"Failed to request Linux root privileges: {str(e)}"}))
                sys.exit(1)

            server.settimeout(30.0)
            try:
                conn, _ = server.accept()
                with conn, conn.makefile('r', encoding='utf-8') as f:
                    for line in f:
                        print(line.strip())
                        sys.stdout.flush()
            except socket.timeout:
                print(json.dumps({"error": "Admin prompt timed out or was rejected."}))
            sys.exit(0)

        elif not is_linux and not is_admin_windows():
            # Trigger Windows UAC prompt
            import ctypes
            server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            server.bind(("127.0.0.1", 0))
            server.listen(1)
            bridge_port = server.getsockname()[1]

            params = ' '.join([f'"{arg}"' for arg in sys.argv[1:]])
            params += f' --ipc {bridge_port}'

            if getattr(sys, 'frozen', False):
                exe_path = sys.executable
                exe_params = params
            else:
                script = os.path.abspath(sys.argv[0])
                exe_path = sys.executable
                exe_params = f'"{script}" {params}'

            ret = ctypes.windll.shell32.ShellExecuteW(None, "runas", exe_path, exe_params, None, 0)
            if int(ret) <= 32:
                print(json.dumps({"error": "Admin privileges required. UAC prompt was rejected."}))
                sys.exit(1)
            
            server.settimeout(15.0)
            try:
                conn, _ = server.accept()
                with conn, conn.makefile('r', encoding='utf-8') as f:
                    for line in f:
                        print(line.strip())
                        sys.stdout.flush()
            except socket.timeout:
                print(json.dumps({"error": "Failed to establish secure IPC bridge with elevated process."}))
            sys.exit(0)

        # --- HARDWARE EXECUTION ROUTER ---
        if command == "--flash":
            verify_flag = "--verify" in sys.argv
            force_gpt_flag = "--force-gpt" in sys.argv
            persistent_mb = 0
            if "--persistent" in sys.argv:
                try:
                    p_idx = sys.argv.index("--persistent")
                    persistent_mb = int(sys.argv[p_idx + 1])
                except: pass
            
            if is_linux:
                import linux_core
                linux_core.set_ipc_socket(ipc_socket)
                linux_core.flash_drive(sys.argv[2], sys.argv[3], verify=verify_flag, force_gpt=force_gpt_flag, persistent_mb=persistent_mb)
            else:
                import windows_core
                windows_core.set_ipc_socket(ipc_socket)
                windows_core.flash_drive(sys.argv[2], sys.argv[3], verify=verify_flag, force_gpt=force_gpt_flag, persistent_mb=persistent_mb)

        elif command == "--restore":
            if is_linux:
                import linux_core
                linux_core.set_ipc_socket(ipc_socket)
                linux_core.restore_drive(sys.argv[2])
            else:
                import windows_core
                windows_core.set_ipc_socket(ipc_socket)
                windows_core.restore_drive(sys.argv[2])

    else:
        # Check USB Drives (Does not require Admin privileges)
        if is_linux:
            import linux_core
            print(json.dumps(linux_core.get_usb_drives(), indent=4))
        else:
            import windows_core
            print(json.dumps(windows_core.get_usb_drives(), indent=4))