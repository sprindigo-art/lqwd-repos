#  Spring Boot + Hibernate + Spring Security + OAuth2 project for demonstration purposes. 

## Getting started
### Prerequisites:
- Java 8
- Maven
- H2/PostgreSQL

It is possible to run application in one of two profiles:
- h2
- postgres

depending on database engine chose for testing. 

To enable cache statistics `dev` profile needs to be turned on.

### Authentication

```
curl -X POST \
  http://localhost:8080/oauth/token \
  -H 'authorization: Basic c3ByaW5nLXNlY3VyaXR5LW9hdXRoMi1yZWFkLXdyaXRlLWNsaWVudDpzcHJpbmctc2VjdXJpdHktb2F1dGgyLXJlYWQtd3JpdGUtY2xpZW50LXBhc3N3b3JkMTIzNA==' \
  -F grant_type=password \
  -F username=admin \
  -F password=admin1234 \
  -F client_id=spring-security-oauth2-read-write-client
```

### Accessing secured endpoints

```
curl -X GET \
  http://localhost:8080/secured/company/ \
  -H 'authorization: Bearer e6631caa-bcf9-433c-8e54-3511fa55816d'
```
"# oauth2server" 


mvnw clean package -Dmaven.test.skip=true

docker build -t localhost:5000/oauth2:latest .  

docker tag c9ed8c7fd6f4 192.168.123.252:5000/oauth2:latest 

 docker push 192.168.123.252:5000/oauth2:latest  
