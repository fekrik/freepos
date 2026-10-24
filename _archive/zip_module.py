import os
import zipfile

def zip_directory(folder_path, zip_path):
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(folder_path):
            for file in files:
                # Create a relative path to keep the directory structure inside the zip
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, os.path.dirname(folder_path))
                zipf.write(file_path, rel_path)

if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    module_dir = os.path.join(current_dir, "pos_surcharge_logic")
    zip_output = os.path.join(current_dir, "pos_surcharge_logic.zip")
    
    print(f"Packaging custom module from: {module_dir}")
    if os.path.exists(module_dir):
        zip_directory(module_dir, zip_output)
        print(f"Successfully created ZIP file at: {zip_output}")
    else:
        print(f"Error: {module_dir} directory not found.")
