package com.lqwd.configurationserver;

import com.google.gson.Gson;
import com.lqwd.configurationserver.models.Commit;
import com.lqwd.configurationserver.models.EventRequest;
import lombok.RequiredArgsConstructor;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.diff.DiffEntry;
import org.eclipse.jgit.diff.DiffFormatter;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.ObjectReader;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.treewalk.CanonicalTreeParser;
import org.eclipse.jgit.util.io.DisabledOutputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.config.server.environment.JGitEnvironmentRepository;
import org.springframework.cloud.config.server.support.GitCredentialsProviderFactory;
import org.springframework.core.io.UrlResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class GitPoolService {

    private final JGitEnvironmentRepository jGitEnvironmentRepository;
    private final RestTemplate restTemplate;

    @Value("${config.branch}")
    private String configBranch;
    @Value("${server.port}")
    private String port;

    private Logger logger = LoggerFactory.getLogger(GitPoolService.class);


    public void pollChangesFromRepository(){
        try {

            Git git = jGitEnvironmentRepository.getGitFactory().getGitByOpen(getWorkingDirectory());

            String branch = git.getRepository().getBranch();

            if(!branch.equalsIgnoreCase(configBranch)){
                git.checkout().setCreateBranch(true).setName(configBranch).call();
            }

            ObjectReader reader = git.getRepository().newObjectReader();
            CanonicalTreeParser oldTreeIter = new CanonicalTreeParser();
            ObjectId oldTree = git.getRepository().resolve("FETCH_HEAD^{tree}" );
            oldTreeIter.reset( reader, oldTree );

            git.fetch().setCredentialsProvider(getCredentialsProvider()).call();

            CanonicalTreeParser newTreeIter = new CanonicalTreeParser();
            ObjectId newTree = git.getRepository().resolve( "FETCH_HEAD^{tree}" );
            newTreeIter.reset( reader, newTree );

            DiffFormatter diffFormatter = new DiffFormatter( DisabledOutputStream.INSTANCE );
            diffFormatter.setRepository( git.getRepository() );
            List<DiffEntry> entries = diffFormatter.scan( newTreeIter, oldTreeIter );

            List<String> propertiesToUpdate = new ArrayList<>();

            for( DiffEntry entry : entries ) {
                String path = shouldUpdate(entry.getNewPath());
                if(path != null)
                    propertiesToUpdate.add(path);
            }


            if(!propertiesToUpdate.isEmpty()){
                callMonitorEndpoint(propertiesToUpdate);
            }

        } catch (Exception e) {
            logger.info("An error occurred when getting diffs: {}", e.getMessage());
        }
    }

    private CredentialsProvider getCredentialsProvider() {
        GitCredentialsProviderFactory gitCredentialsProviderFactory = new GitCredentialsProviderFactory();
        return gitCredentialsProviderFactory.createFor(jGitEnvironmentRepository.getUri(),
                jGitEnvironmentRepository.getUsername(), jGitEnvironmentRepository.getPassword(),
                jGitEnvironmentRepository.getPassphrase(), jGitEnvironmentRepository.isSkipSslValidation());
    }

    protected File getWorkingDirectory() {

        if (jGitEnvironmentRepository.getUri().startsWith("file:")) {
            try {
                return new UrlResource(StringUtils.cleanPath(jGitEnvironmentRepository.getUri())).getFile();
            }
            catch (Exception e) {
                throw new IllegalStateException("Cannot convert uri to file: "
                        + jGitEnvironmentRepository.getUri());
            }
        }
        return jGitEnvironmentRepository.getBasedir();
    }


    private String shouldUpdate(String refreshPath){

        if(refreshPath.equalsIgnoreCase("/dev/null"))
            return null;

        return refreshPath;
    }

    private void callMonitorEndpoint(List<String> modified){

        EventRequest request = new EventRequest();
        Commit commit = new Commit();
        commit.setChanges(modified);
        request.setPush(commit);

        logger.info("Refresh request is : {}",new Gson().toJson(request));

        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/json");
        headers.set("X-Event-Key","repo:push");
        headers.set("X-Hook-UUID","webhook-uuid");

        HttpEntity entity = new HttpEntity(request,headers);

        ResponseEntity<String> res = restTemplate.exchange(String.format("http://localhost:%s/monitor",port),
                HttpMethod.POST, entity, String.class);

        logger.info("response is: {}", res.getStatusCode());


    }


}
