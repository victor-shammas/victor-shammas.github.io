import os

# --- Configuration ---
# Path to your extracted aliases file
ALIASES_FILE = 'aliases.txt' 
# Path to your Hugo content directory
CONTENT_DIR = './content'         

def process_aliases():
    if not os.path.exists(ALIASES_FILE):
        print(f"Error: {ALIASES_FILE} not found.")
        return

    with open(ALIASES_FILE, 'r') as f:
        # Read aliases and remove any blank lines
        aliases = [line.strip() for line in f if line.strip()]

    for alias in aliases:
        # Extract the slug (the last part of the URL)
        # e.g., /blog/2025/2/18/fluid-fascism -> fluid-fascism
        slug = alias.rstrip('/').split('/')[-1]
        
        # Find the matching markdown file
        matched_file = None
        for root, dirs, files in os.walk(CONTENT_DIR):
            for file in files:
                # Matches if the filename contains the slug and is a markdown file
                if file.endswith('.md') and slug in file:
                    matched_file = os.path.join(root, file)
                    break
            if matched_file:
                break
        
        if not matched_file:
            print(f"⚠️  Not found: Could not find a .md file matching '{slug}'")
            continue

        # Read the markdown file
        with open(matched_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # Skip if alias is already in the file
        if alias in content:
            print(f"⏭️  Skipping: Alias already exists in {matched_file}")
            continue

        # Inject the alias into the YAML front matter
        if content.startswith('---'):
            # Find the second '---' that closes the front matter
            end_idx = content.find('\n---', 3) 
            
            if end_idx != -1:
                # Format the YAML to be injected
                alias_yaml = f"\naliases:\n  - {alias}"
                
                # IMPORTANT: This assumes 'aliases:' doesn't exist yet in the front matter.
                # If it does, this will create a duplicate key.
                new_content = content[:end_idx] + alias_yaml + content[end_idx:]
                
                # Write the modified content back to the file
                with open(matched_file, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"✅ Success: Added alias to {matched_file}")
            else:
                print(f"❌ Error: Could not find closing '---' in {matched_file}")
        else:
            print(f"❌ Error: No YAML front matter (starting with '---') found in {matched_file}")

if __name__ == '__main__':
    process_aliases()