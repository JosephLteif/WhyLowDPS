with open(r'c:\Users\user\Desktop\Programming\simcraft\backend\resources\data\equippable-items.json', 'r') as f:
    for i, line in enumerate(f):
        if ': -1' in line:
            print(f"Line {i+1}: {line.strip()}")
            if i > 634020 and i < 634100:
                print("MATCH NEAR PANIC LINE")
