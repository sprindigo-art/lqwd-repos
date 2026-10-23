
import requests

from lightning import LndNode

from l402_api_chain import L402APIChain
from langchain.llms import OpenAI

# Initialize LndNode
lnd_node = LndNode(
    cert_path='path/to/tls.cert',
    macaroon_path='path/to/admin.macaroon',
    host='localhost',
    port=10018
)

# You can also use this with an API Chain instance like so:
llm = OpenAI(temperature=0)
chain_new = L402APIChain.from_llm_and_api_docs(
    llm, API_DOCS, lightning_node=lnd_node, verbose=True,
)

# Swap our the default wrapper with our L402 aware wrapper.
chain_new.requests_wrapper = lang_chain_request_L402

output = chain_new.run('LLM query here')
print(output)



if __name__ == "__main__":
    main()