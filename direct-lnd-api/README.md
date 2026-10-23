# LND advanced process
Description:
This Micro service responsible get LND command from Front End and 
Send Fomrated message to Kafka


Produces and consumer with schema registry in avro 

#make package with test
mvnw clean package
#make package without test
mvnw clean package -Dmaven.test.skip=true


1. mvn clean
2. mvn clean install
3. Go to the target folder
4. java -jar -----0.0.1-SNAPSHOT.jar


mvn generate-sources


  
  
 #Step 1:
    Add micro-service authentication (client_id and pass) (mservice)
    lnd-advanced-processing-send-message/lndap-send-message-secret-KEY12##3
    
 #Important notes
 mservice name and password is only example. for real use ask Admin for Microservice.   




keytool -import -alias lndv2tls -file c:\hp\tls.cert -storetype JKS -keystore server.truststore

keytool -ilist-keystore server.truststore


install kubctl:

apt install curl

curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"

curl -LO "https://dl.k8s.io/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl.sha256"

echo "$(<kubectl.sha256) kubectl" | sha256sum --check

install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

kubectl version --client

kubectl cluster-info config --kubeconfig=config/config.kubernetes



port 443


