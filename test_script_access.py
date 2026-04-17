#!/usr/bin/env python3
import os
import subprocess

# Check if scripts directory exists
scripts_dir = "scripts"
if os.path.exists(scripts_dir):
    print(f"Scripts directory found: {scripts_dir}")
    files = os.listdir(scripts_dir)
    print(f"Files in scripts directory: {files}")
    
    # Try to run the scripts
    script1 = f"{scripts_dir}/run-openclaw-connection-operation.sh"
    script2 = f"{scripts_dir}/dss-ci-monitor.sh"
    
    if os.path.exists(script1):
        print(f"Script 1 exists: {script1}")
        # Run first script
        try:
            result1 = subprocess.run(["bash", script1], capture_output=True, text=True)
            print(f"Script 1 exit code: {result1.returncode}")
            print(f"Script 1 stdout: {result1.stdout}")
            print(f"Script 1 stderr: {result1.stderr}")
        except Exception as e:
            print(f"Error running script 1: {e}")
    else:
        print(f"Script 1 not found: {script1}")
    
    if os.path.exists(script2):
        print(f"Script 2 exists: {script2}")
        # Run second script
        try:
            result2 = subprocess.run(["bash", script2], capture_output=True, text=True)
            print(f"Script 2 exit code: {result2.returncode}")
            print(f"Script 2 stdout: {result2.stdout}")
            print(f"Script 2 stderr: {result2.stderr}")
        except Exception as e:
            print(f"Error running script 2: {e}")
    else:
        print(f"Script 2 not found: {script2}")
else:
    print(f"Scripts directory not found: {scripts_dir}")