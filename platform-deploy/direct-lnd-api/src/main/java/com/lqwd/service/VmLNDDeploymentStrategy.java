package com.lqwd.service;

import com.amazonaws.AmazonServiceException;
import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.BasicAWSCredentials;
import com.amazonaws.regions.Regions;
import com.amazonaws.services.ec2.AmazonEC2;
import com.amazonaws.services.ec2.AmazonEC2ClientBuilder;
import com.amazonaws.services.ec2.model.CreateTagsRequest;
import com.amazonaws.services.ec2.model.DescribeInstancesRequest;
import com.amazonaws.services.ec2.model.DescribeInstancesResult;
import com.amazonaws.services.ec2.model.Instance;
import com.amazonaws.services.ec2.model.LaunchTemplateSpecification;
import com.amazonaws.services.ec2.model.ModifyInstanceAttributeRequest;
import com.amazonaws.services.ec2.model.RunInstancesRequest;
import com.amazonaws.services.ec2.model.RunInstancesResult;
import com.amazonaws.services.ec2.model.Tag;
import com.amazonaws.services.ec2.model.TerminateInstancesRequest;
import com.amazonaws.waiters.PollingStrategy;
import com.amazonaws.waiters.WaiterParameters;
import com.amazonaws.waiters.WaiterTimedOutException;
import com.amazonaws.waiters.WaiterUnrecoverableException;
import com.lqwd.config.AppProperties;
import com.lqwd.config.KafkaConfigVariables;
import com.lqwd.interfaces.LNDDeploymentStrategy;
import com.lqwd.model.DeployNodeRequest;
import com.lqwd.model.DeployNodeResponse;
import com.lqwd.model.DestroyNodeRequest;
import com.lqwd.model.DestroyNodeResponse;
import com.lqwd.model.enums.LndNetwork;
import com.lqwd.model.request.CreateLndNodeRequest;
import lombok.RequiredArgsConstructor;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Base64;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
public class VmLNDDeploymentStrategy implements LNDDeploymentStrategy {

    Logger logger = LoggerFactory.getLogger(K8LNDDeploymentStrategy.class);

    private final AppProperties properties;
    private final KafkaConfigVariables configVariables;

    private final LNDDatabaseHandler lndDatabaseHandler;



    @Override
    public DeployNodeResponse deploy(DeployNodeRequest request, CreateLndNodeRequest createLndNodeRequest, String token) {

        BasicAWSCredentials awsCred = new BasicAWSCredentials(properties.getAws_ec2_access_key_id(),
                properties.getAws_ec2_secret_access_key());

        AmazonEC2 ec2 = AmazonEC2ClientBuilder.standard().withCredentials
                        (new AWSStaticCredentialsProvider(awsCred)).withRegion(Regions.US_EAST_2)
                .build();

        LaunchTemplateSpecification specification = new LaunchTemplateSpecification()
                .withLaunchTemplateId(properties.getAws_ec2_launch_template_id());

        String userDataB64 = Base64.getEncoder().encodeToString(createVMEnvironment(request).getBytes());

        RunInstancesRequest run_request = new RunInstancesRequest()
                .withLaunchTemplate(specification)
                .withUserData(userDataB64)
                .withMaxCount(1)
                .withMinCount(1);

        RunInstancesResult run_response = ec2.runInstances(run_request);

        Instance instance = run_response.getReservation().getInstances().get(0);

        logger.info(
                "Successfully started EC2 instance {} based on launch template {}",
                instance.getInstanceId(), properties.getAws_ec2_launch_template_id());

        Tag tag = new Tag()
                .withKey("Name")
                .withValue(request.getNodeName());

        CreateTagsRequest tag_request = new CreateTagsRequest()
                .withResources(instance.getInstanceId())
                .withTags(tag);

        ec2.createTags(tag_request);


        DescribeInstancesRequest describeInstancesRequest = new DescribeInstancesRequest()
                .withInstanceIds(instance.getInstanceId());

        if (!isEc2Running(ec2, describeInstancesRequest)) {
            logger.info("Couldn't determine running status");
            DestroyNodeRequest destroyNodeRequest = DestroyNodeRequest.builder()
                    .instanceId(instance.getInstanceId()).nodeName(request.getNodeName()).build();

            this.destroy(destroyNodeRequest);

            return DeployNodeResponse.builder().success(false).build();
        }


        DescribeInstancesResult result = ec2.describeInstances(describeInstancesRequest);
        instance = result.getReservations().get(0).getInstances().get(0);

        return DeployNodeResponse.builder().privateAddress(instance.getPrivateIpAddress())
                .publicAddress(instance.getPublicIpAddress())
                .instanceId(instance.getInstanceId()).success(true).build();
    }

    private PollingStrategy pollingStrategy(int retryCount, int secondsToSleep){

        PollingStrategy.RetryStrategy retryStrategy = ctx -> (ctx.getRetriesAttempted() < retryCount);
        PollingStrategy.DelayStrategy delayStrategy = ctx -> sleep(secondsToSleep);

        return new PollingStrategy(retryStrategy, delayStrategy);
    }


    private boolean isEc2Running(AmazonEC2 ec2, DescribeInstancesRequest describeInstancesRequest) {

        try {
            ec2.waiters().instanceRunning().run(new WaiterParameters()
                    .withRequest(describeInstancesRequest)
                    .withPollingStrategy(pollingStrategy(5,5)));

        } catch (WaiterTimedOutException | WaiterUnrecoverableException | AmazonServiceException ex) {
            return false;
        }

        return true;
    }

    private boolean isEc2Terminated(AmazonEC2 ec2, DescribeInstancesRequest describeInstancesRequest) {

        try {
            ec2.waiters().instanceTerminated().run(new WaiterParameters()
                    .withRequest(describeInstancesRequest)
                    .withPollingStrategy(pollingStrategy(10, 7)));

        } catch (WaiterTimedOutException | WaiterUnrecoverableException | AmazonServiceException ex) {
            return false;
        }

        return true;
    }

    private void sleep(int seconds) {
        try {
            TimeUnit.SECONDS.sleep(seconds);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }

    @Override
    public DestroyNodeResponse destroy(DestroyNodeRequest request) {

        BasicAWSCredentials awsCred = new BasicAWSCredentials(properties.getAws_ec2_access_key_id(),
                properties.getAws_ec2_secret_access_key());

        AmazonEC2 ec2 = AmazonEC2ClientBuilder.standard().withCredentials
                        (new AWSStaticCredentialsProvider(awsCred)).withRegion(Regions.US_EAST_2)
                .build();

        //disable termination rule
        ModifyInstanceAttributeRequest modify = new ModifyInstanceAttributeRequest()
                .withDisableApiTermination(false).withInstanceId(request.getInstanceId());

        ec2.modifyInstanceAttribute(modify);

        //terminate instance
        TerminateInstancesRequest terminate = new TerminateInstancesRequest().withInstanceIds(request.getInstanceId());
        ec2.terminateInstances(terminate);

        //confirm instance termination
        DescribeInstancesRequest describeInstancesRequest = new DescribeInstancesRequest()
                .withInstanceIds(request.getInstanceId());

        if(!isEc2Terminated(ec2, describeInstancesRequest)){
            logger.info(
                    "failed to terminate EC2 instance {}",
                    request.getInstanceId());
            return DestroyNodeResponse.builder().success(false).build();
        }


        logger.info(
                "Successfully terminated EC2 instance {}",
                request.getInstanceId());

        lndDatabaseHandler.deleteLNDDatabase(request.getNodeName());


        return DestroyNodeResponse.builder().success(true).build();
    }

    @Override
    public String getAddress(JSONObject nodeInfo) {
        Object address = nodeInfo.get("privateAddress");
        return address == null ? "" : address.toString();
    }

    private String createVMEnvironment(DeployNodeRequest request) {


        StringBuilder script = new StringBuilder();
        script.append("#!/bin/bash -xe");
        script.append("\n");
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "DEBUG", properties.getLnd_debug()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "REDIS_HOST", properties.getRedis_host()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "REDIS_PORT", properties.getRedis_port()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "LND_SEED_EXP_SECONDS", properties.getLnd_seed_exp_seconds()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "NOTIFICATION_EMAILS", properties.getNode_alert_email_to()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "KAFKA_PRO_TOPIC", properties.getLnd_kafka_pro_topic()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "KAFKA_CO_GROUP_ID", properties.getLnd_kafka_co_group_id()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "KAFKA_CO_TOPIC", properties.getLnd_kafka_co_topic()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "KAFKA_HOST", configVariables.getBootstrapServers()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "SCHEMA_HOST", configVariables.getSchemaRegistryUrl()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "OAUTH_BASE_URL", String.format("http://%s:%s", properties.getAuth_post_url(),
                        properties.getAuth_post_port())));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "CIPHER_BASE_URL", String.format("http://%s:%s", properties.getCipher_url(),
                        properties.getCipher_port())));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "KAFKA_CO_TOPIC", properties.getLnd_kafka_co_topic()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "LND_EXTERNAL_IP", "192.168.123.252"));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "LND_POD_NAME", request.getNodeName()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "LND_NON_CUSTODIAL_VALUE", request.isNonCustodial() ? "1" : "0"));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "KEY_SEND_ENABLED", request.isKeySendEnabled() ? "1" : "0"));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "USE_POSTGRES", 1));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "WATCHTOWER", request.isWatchTower()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "LND_NETWORK", request.getLndNetwork().toString()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "ALIAS", request.getAlias()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "LND_RPC_HOST", getBitcoinHostBasedOnNetwork(request.getLndNetwork())));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "LND_DB_HOST", properties.getLnd_db_host()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "WENV", properties.getWenv()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "LND_DB_PORT", properties.getLnd_db_port()));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "RESTORATION_NODE", request.isRestoration() ? "1" : "0"));
        script.append(String.format("echo 'export %s=%s' >> /etc/profile\n",
                "OWNER", request.getOwnersEmail()));

        script.append("exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1\n");
        script.append("apt-get update\n");
        script.append("apt-get -y install nano net-tools jq wget python3 git python3-pip python3-psycopg2 awscli\n");
        script.append("pip3 install --no-cache-dir pexpect python-lnd-grpc requests psycopg2 redis boto3 grpcio grpcio-tools googleapis-common-protos avro-python3 aiohttp confluent-kafka retrying\n");
        script.append("pip3 install --no-cache-dir --no-binary=protobuf protobuf\n");
        script.append("pip3 install awsebcli awscli --upgrade\n");
        script.append("apt-get update\n");
        script.append("aws s3 cp s3://lqwd-lnd-scripts/lnd_script_update.sh /home/ubuntu/\n");
        script.append("grep -qxF 'lnd_script_update.sh' /etc/crontab || echo '5 0 * * * sudo bash /home/ubuntu/lnd_script_update.sh ' >> /etc/crontab\n");

        return script.toString();
    }

    private String getBitcoinHostBasedOnNetwork(LndNetwork network) {

        if (network.equals(LndNetwork.TESTNET)) {
            return properties.getK8s_rpchost_testnet();
        } else if (network.equals(LndNetwork.REGTEST)) {
            return properties.getK8s_rpchost_regtest();
        } else {
            return properties.getK8s_rpchost();
        }
    }
}
