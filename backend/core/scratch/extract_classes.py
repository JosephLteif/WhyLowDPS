import re
import json

def extract_data(file_path):
    with open(file_path, 'r') as f:
        content = f.read()

    # Find the CLASSES static block
    classes_match = re.search(r'static CLASSES: &\[ClassDef\] = &\[(.*?)\];', content, re.DOTALL)
    if not classes_match:
        print("Could not find CLASSES static block")
        return []

    classes_text = classes_match.group(1)
    
    classes = []
    # Split into individual ClassDef blocks
    class_blocks = re.findall(r'ClassDef \{(.*?)\},', classes_text, re.DOTALL)
    
    for block in class_blocks:
        class_name = re.search(r'name: "(.*?)",', block).group(1)
        aliases_match = re.search(r'aliases: &\[(.*?)\],', block)
        aliases = []
        if aliases_match:
            aliases = [a.strip().strip('"') for a in aliases_match.group(1).split(',') if a.strip()]
        
        max_armor = int(re.search(r'max_armor: (\d+),', block).group(1))
        weapons_match = re.search(r'weapons: &\[(.*?)\],', block)
        weapons = []
        if weapons_match:
            weapons = [int(w.strip()) for w in weapons_match.group(1).split(',') if w.strip()]
            
        specs_match = re.search(r'specs: &\[(.*?)\],', block, re.DOTALL)
        specs = []
        if specs_match:
            spec_defs = re.findall(r'SpecDef \{(.*?)\},', specs_match.group(1), re.DOTALL)
            for s_block in spec_defs:
                spec_name = re.search(r'name: "(.*?)",', s_block).group(1)
                spec_id = int(re.search(r'id: (\d+),', s_block).group(1))
                s_weapons_match = re.search(r'weapon_subclasses: &\[(.*?)\],', s_block)
                s_weapons = []
                if s_weapons_match:
                    s_weapons = [int(w.strip()) for w in s_weapons_match.group(1).split(',') if w.strip()]
                
                dual_wield = "true" in re.search(r'can_dual_wield: (.*?),', s_block).group(1)
                shield = "true" in re.search(r'can_use_shield: (.*?),', s_block).group(1)
                offhand = "true" in re.search(r'can_use_offhand: (.*?),', s_block).group(1)
                
                specs.append({
                    "name": spec_name,
                    "id": spec_id,
                    "weapon_subclasses": s_weapons,
                    "can_dual_wield": dual_wield,
                    "can_use_shield": shield,
                    "can_use_offhand": offhand
                })
        
        classes.append({
            "name": class_name,
            "aliases": aliases,
            "max_armor": max_armor,
            "weapons": weapons,
            "specs": specs
        })
        
    return classes

if __name__ == "__main__":
    path = r'c:\Users\user\Desktop\Programming\simcraft\backend\core\src\types\class_data.rs'
    data = extract_data(path)
    with open('classes.json', 'w') as f:
        json.dump(data, f, indent=2)
    print("Extracted data to classes.json")
