import requests
from bs4 import BeautifulSoup

url = "https://1ml.com/node"

response = requests.get(url)
soup = BeautifulSoup(response.content, "html.parser")

pubkey_elements = soup.find_all("strong", class_="small selectable")
pubkeys = [element.get_text() for element in pubkey_elements]

for pubkey in pubkeys:
    print(pubkey)
