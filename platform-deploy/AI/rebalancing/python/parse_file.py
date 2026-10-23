from bs4 import BeautifulSoup

# Read the HTML content from a file
with open('canada.html', 'r', encoding='utf-8') as file:
    html_content = file.read()

# Parse the HTML content using Beautiful Soup
soup = BeautifulSoup(html_content, 'html.parser')

# Find all anchor elements (links)
link_elements = soup.find_all('a')

# Extract and save links to a file
with open('links.txt', 'w') as f:
    for link in link_elements:
        link_url = link.get('href')
        if link_url:
            f.write(link_url + '\n')

print("Links saved to 'links.txt'")


# Read data from links.txt file line by line
with open('links.txt', 'r') as links_file:
    lines = links_file.readlines()

# Process and modify each line
modified_lines = []
prefix_to_remove = "https://mempool.space/lightning/node/"
for line in lines:
    line = line.strip()  # Remove leading/trailing whitespace and newline characters
    if line.startswith(prefix_to_remove):
        pubkey = line[len(prefix_to_remove):]  # Remove the prefix
        modified_lines.append(pubkey)

# Save modified lines to pubkey_Canada.txt file
with open('pubkey_Canada.txt', 'w') as pubkey_file:
    for pubkey in modified_lines:
        pubkey_file.write(pubkey + '\n')

print("Modified pubkeys saved to 'pubkey_Canada.txt'")
