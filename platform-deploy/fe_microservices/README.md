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