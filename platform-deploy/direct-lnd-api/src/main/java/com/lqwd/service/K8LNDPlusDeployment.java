package com.lqwd.service;


import com.lqwd.config.AppProperties;
import com.lqwd.config.KubernetesConfig;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.interfaces.LNDPlusDeployment;
import com.lqwd.model.DeployLNDPlus;
import io.fabric8.kubernetes.api.model.IntOrString;
import io.fabric8.kubernetes.api.model.Quantity;
import io.fabric8.kubernetes.api.model.ServiceBuilder;
import io.fabric8.kubernetes.api.model.apps.Deployment;
import io.fabric8.kubernetes.api.model.apps.DeploymentBuilder;
import io.fabric8.kubernetes.client.Config;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.KubernetesClientBuilder;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.Collections;

@Service
@RequiredArgsConstructor
public class K8LNDPlusDeployment implements LNDPlusDeployment {

    Logger logger = LoggerFactory.getLogger(K8LNDPlusDeployment.class);

    private final AppProperties properties;
    private final KubernetesConfig kubernetesConfig;
    private final HttpClientToken httpClientToken;

    @Value("${app.volume.claim}")
    private String volumeClaim;



    @Override
    public boolean deployLNDPlus(DeployLNDPlus request) throws IOException {

        String appName = "lndplus-" + System.currentTimeMillis() + "-" + request.getNodeName();

        Config config = kubernetesConfig.getKubernetesConfig();

        KubernetesClient client = new KubernetesClientBuilder().withConfig(config).build();

        if (!createK8Service(appName, client)){
            return false;
        }


        Deployment deployment = buildLndPlusDeployment( appName, request.getNodeName(),
                 request.getNetwork());

        try {

            deployment = client.apps().deployments().inNamespace(properties.getLnd_namespace()).create(deployment);

        } catch (Exception e) {
            logger.info(e.getMessage());

            return false;
        }

        httpClientToken.lndNodeAddLit(request.getAccessToken(), request.getNodeName(),
                deployment.getMetadata().getName(),
                "/lndnode/setlitnode", "LndNodeInfo");

        return true;

    }


    private Deployment buildLndPlusDeployment(String appName,
                                              String lndNodeName, String network) {
        DeploymentBuilder builder = new DeploymentBuilder()
                .withNewMetadata()
                .withName(appName)
                .withNamespace(properties.getLnd_namespace())
                .withLabels(Collections.singletonMap("app", appName))
                .endMetadata()
                .withNewSpec()

                .withNewSelector()
                .withMatchLabels(Collections.singletonMap("app", appName))
                .endSelector()

                .withNewTemplate()
                .withNewMetadata()
                .withLabels(Collections.singletonMap("app", appName))
                .endMetadata()

                .withNewSpec()
                .addNewContainer()
                .withName(lndNodeName)
                .withImage(properties.getLndplus_image_path())

                .addNewEnv()
                .withName("LND_PODNAME")
                .withValue(lndNodeName)
                .endEnv()

                .addNewEnv()
                .withName("LIT_UI_PASSWORD")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("LIT_UI_PASSWORD")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()


                .addNewEnv()
                .withName("LND_NETWORK")
                .withValue(network)
                .endEnv()


                .addNewEnv()
                .withName("CLIENT_SECRET")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("CLIENT_SECRET")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("CLIENT_ID")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("CLIENT_ID")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("CIPHER_BASE_URL")
                .withValue(String.format("http://%s:%s", properties.getCipher_url(),
                        properties.getCipher_port()))
                .endEnv()

                .addNewEnv()
                .withName("OAUTH_BASE_URL")
                .withValue(String.format("http://%s:%s", properties.getAuth_post_url(),
                        properties.getAuth_post_port()))
                .endEnv()

                .addNewEnv()
                .withName("LND_HOST")
                .withValue(String.format("%s.%s", lndNodeName, properties.getLnd_namespace()))
                .endEnv()

                .addNewPort()
                .withContainerPort(8443)
                .endPort()

                .addNewVolumeMount()
                .withName("lnd")
                .withMountPath("/data")
                .endVolumeMount()
                .withImagePullPolicy("Always")
                .withTerminationMessagePolicy("File")
                .withNewResources()
                .withRequests(Collections.singletonMap("memory",
                        new Quantity(determineRequestMemory(true))))
                .withLimits(Collections.singletonMap("memory",
                        new Quantity(determineLimitMemory(true))))
                .endResources()
                .endContainer()

                .addNewVolume()
                .withName("lnd")
                .withNewPersistentVolumeClaim()
                .withClaimName(volumeClaim)
                .endPersistentVolumeClaim()
                .endVolume()

                .addNewVolume()
                .withName("secret")
                .withNewSecret()
                .withSecretName("secret")
                .endSecret()
                .endVolume()

                .endSpec()
                .endTemplate()
                .endSpec();
        return builder.build();
    }

    public boolean createK8Service(String appName, KubernetesClient client) {

        io.fabric8.kubernetes.api.model.Service service = new ServiceBuilder()
                .withNewMetadata()
                .withName(appName)
                .withNamespace(properties.getLnd_namespace())
                .withLabels(Collections.singletonMap("app", appName))
                .endMetadata()
                .withNewSpec()
                .withSelector(Collections.singletonMap("app", appName))
                .addNewPort()
                .withName("tcp-8443")
                .withProtocol("TCP")
                .withPort(8443)
                .withTargetPort(new IntOrString(8443))
                .endPort()
                .withType("NodePort")
                .endSpec().build();

        client.services().inNamespace(properties.getLnd_namespace()).create(service);

        logger.info("Created service with name {}", service.getMetadata().getName());


        return true;

    }

    private String determineLimitMemory(boolean isRoutingNode) {
        return isRoutingNode ? properties.getLnd_node_limit_mem().get("routing")
                : properties.getLnd_node_limit_mem().get("default");
    }

    private String determineRequestMemory(boolean isRoutingNode) {
        return isRoutingNode ? properties.getLnd_node_request_mem().get("routing")
                : properties.getLnd_node_request_mem().get("default");
    }
}
