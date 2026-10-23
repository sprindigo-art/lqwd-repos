import requests

from lightning_a import LndNode

#from L402.l402_api_chain import L402APIChain
#from langchain.llms import OpenAI

# Initialize LndNode
lnd_node = LndNode(
    cert_path='/Users/azizpulatov/LND_NODE/tls.cert',
    macaroon_path='/Users/azizpulatov/LND_NODE/data/chain/bitcoin/mainnet/admin.macaroon',
    host='localhost',
    port=10009
)
print(lnd_node.channel_balance())
# You can also use this with an API Chain instance like so:
# llm = OpenAI(temperature=0)
# chain_new = L402APIChain.from_llm_and_api_docs(
#     llm, API_DOCS, lightning_node=lnd_node, verbose=True,
# )
#
# # Swap our the default wrapper with our L402 aware wrapper.
# chain_new.requests_wrapper = lang_chain_request_L402
#
# output = chain_new.run('LLM query here')
# print(output)