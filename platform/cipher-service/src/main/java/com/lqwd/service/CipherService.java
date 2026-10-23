package com.lqwd.service;

import com.lqwd.cipherengine.BaseCipherEngineComponent;
import com.lqwd.constants.ApplicationConstants;
import com.lqwd.exception.CipherEngineException;
import com.lqwd.interfaces.CipherEngine;
import com.lqwd.interfaces.CipherEngineFactory;
import com.lqwd.exception.ApplicationRequestException;
import com.lqwd.model.entity.CipherKeyUpdate;
import com.lqwd.model.entity.CipherMethod;
import com.lqwd.model.entity.LndFile;
import com.lqwd.model.entity.SecretKeyChangeLog;
import com.lqwd.model.request.*;
import com.lqwd.model.response.CipherMethodResponse;
import com.lqwd.model.response.EncryptDecryptResponse;
import com.lqwd.model.response.LndFileItem;
import com.lqwd.model.response.LndFileResponse;
import com.lqwd.repository.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.NoSuchBeanDefinitionException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Service
public class CipherService {

    static final String INPUT_METHOD="method";
    static final String INPUT_DATA="data";

    Logger logger = LoggerFactory.getLogger(CipherService.class);

    @Value("${spring.profiles.active}")
    private String activeProfile;

    private void infoLog(String message, String ... variables){
        if(activeProfile.contains("staging") || activeProfile.contains("development")){
            logger.info(message, variables);
        }
    }

    private void errorLog(String message, String ... variables){
        if(activeProfile.contains("staging") || activeProfile.contains("development")){
            logger.error(message, variables);
        }
    }

    @Autowired
    private CipherEngineFactory cipherEngineFactory;

    @Autowired
    private CipherMethodRepository cipherMethodRepository;

    @Autowired
    private CipherMethodUpdateRepository cipherMethodUpdateRepository;

    @Autowired
    private LndFileRepository lndFileRepository;

    @Autowired
    private SecretKeyChangeLogRepository secretKeyChangeLogRepository;

    @Autowired
    private CipherKeyUpdateRepository cipherKeyUpdateRepository;

    @Autowired
    ApplicationContext context;


    @Autowired
    OauthService oauthService;

    @Autowired
    KubenetesService kubenetesService;


    public String setPassword(SetPasswordRequest request){
        List<LndFile> files = lndFileRepository.getAllUserFilesByNode(request.getNodeName());
        try {
            for (int i = 0; i < files.size(); i++) {

                //some files may not be using any encryption/decryption methode so we need to check for that
                //by decrypting with appropriate cipher engine or returning the file as is if not using any encryption/decryption method.
                if (files.get(i).getCipherMethod() != null && files.get(i).getCipherMethod() != 0L) {
                    //load cipher engine
                    CipherMethod cipherMethod = cipherMethodRepository.findById(files.get(i).getCipherMethod()).get();
                    CipherEngine cipherEngine = getCipherEngine(cipherMethod.getName());


                    //load secretkey
                    String secretKey = new String(Base64.getDecoder().decode(cipherMethod.getSecretKey()));

                    //decrypt file
                    String decrypted = cipherEngine.decrypt(Base64.getEncoder().encodeToString(files.get(i).getSfile()), secretKey, request.getOldPassword());

                    //encrypt file with new password
                    String encrypted = cipherEngine.encrypt(decrypted, secretKey, request.getNewPassword());
                    files.get(i).setSfile(Base64.getDecoder().decode(encrypted));
                }
            }
            lndFileRepository.saveAll(files);
            return "OK";
        }catch (GeneralSecurityException ex){
            errorLog("here was an issue while trying to update password.  Error : {}",ex.getMessage());
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "There was an issue while trying to update password");
        }catch (IOException ex){
            errorLog("here was an issue while trying to update password.  Error : {}",ex.getMessage());
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "There was an issue while trying to update password");
        }
    }

    public String saveLndFile(SaveLndFileRequest request){
        //use default method to encrypt
        CipherMethod method = cipherMethodRepository.findDefault().get();
        CipherEngine cipherEngine = getCipherEngine(method.getName());
        try {
            java.util.Date date = new Date();
            SimpleDateFormat formatter = new SimpleDateFormat("yyyy_MM_dd");
            String format = formatter.format(date);
            String newNodeName = request.getNodeName() + "_" + format;
            lndFileRepository.clearLndFiles(newNodeName, request.getNodeName());
            for(com.lqwd.model.request.LndFileItem fileItem : request.getFiles() ){
                byte [] byteData = Base64.getDecoder().decode(fileItem.getData());
                byte [] secretKeyByteData  = Base64.getDecoder().decode(method.getSecretKey());
                Long methodId = 0L;

                if(fileItem.getEncryptBeforeSave() == null || fileItem.getEncryptBeforeSave() == true){
                    String encryptedBase64String = cipherEngine.encrypt(fileItem.getData(), new String(secretKeyByteData),(fileItem.getIsUserFile() !=null && fileItem.getIsUserFile()== true)?request.getPassword():null);
                    byteData = Base64.getDecoder().decode(encryptedBase64String);
                    methodId = method.getId();
                }
                LndFile file = LndFile.builder()
                        .fileType(fileItem.getFileType())
                        .fileName(fileItem.getFileName())
                        .domain(request.getDomain())
                        .key(request.getKey())
                        .network(request.getNetwork())
                        .isUserFile(fileItem.getIsUserFile()==null? false : fileItem.getIsUserFile())
                        .nodeName(request.getNodeName())
                        .queuedForUpdate(false)
                        .cipherMethod(methodId)
                        .sfile(byteData)
                        .rpchost(request.getRpchost())
                        .pubkey(request.getPubkey())
                        .rpcpass(request.getRpcpass())
                        .rpcuser(request.getRpcuser())
                        .watchtower(request.getWatchtower() == null?false:request.getWatchtower())
                        .build();

                lndFileRepository.save(file);
                infoLog("Saving file. Cipher Method : {}, File : {}",(methodId == 0L? "NONE" : method.getName()), fileItem.getFileName() );
            }
//            oauthService.setNodeStatusAsRunning(request.getNodeName(), request.getPubkey());
//            infoLog("Setting status for node : {}  running  ",request.getNodeName() );
            return "OK";
        } catch (GeneralSecurityException e) {
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot encrypt and save file");
        } catch (IOException e) {
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot encrypt and save file");
        }
    }


    /**
     * Load all found cipher engine spring beans.
     * @return
     */
    public List<String> getAllFoundCipherEngines(){
        return Arrays.asList(context.getBeanNamesForType(BaseCipherEngineComponent.class)).stream().filter((item)->!item.equals("baseCipherEngineComponent")).collect(Collectors.toList());
    }

    /**
     * Gets the appropriate cipher engine based on the provided cipher method
     *
     * First of all checks if the cipher method is registered in the db
     * @param cipherMethodName
     * @return
     */
    private CipherEngine getCipherEngine(String cipherMethodName){
        CipherMethod cipherMethod = null;
        if(cipherMethodName == null){
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot load encryption/decryption method please provice cipher method name");
        }
        cipherMethod = cipherMethodRepository.findByName(cipherMethodName).orElse(null);
        if(cipherMethod == null){
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot load encryption/decryption method");
        }

        try{
            CipherEngine cipherEngine = cipherEngineFactory.getCipherEngine(cipherMethod.getName());
            return cipherEngine;
        }catch (NoSuchBeanDefinitionException exception){
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot load encryption/decryption method");
        }catch (CipherEngineException exception){
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), exception.getMessage());
        }
    }

    public EncryptDecryptResponse testEncryption(TextCipherRequest textCipherRequest){
        CipherEngine cipherEngine = getCipherEngine(textCipherRequest.getMethodName());
        try {
            String resp = cipherEngine.encrypt(Base64.getEncoder().encodeToString(textCipherRequest.getText().getBytes()), textCipherRequest.getSecretKey(), null);
            return EncryptDecryptResponse.builder().data(resp).build();
        } catch (GeneralSecurityException e) {
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot encrypt. Server error");
        } catch (IOException e) {
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot encrypt. IO error");
        }
    }

    public EncryptDecryptResponse testDecryption(TextCipherRequest textCipherRequest){
        CipherEngine cipherEngine = getCipherEngine(textCipherRequest.getMethodName());
        try {
            String resp = cipherEngine.decrypt(textCipherRequest.getText(), textCipherRequest.getSecretKey(), null);
            return EncryptDecryptResponse.builder().data(new String(Base64.getDecoder().decode(resp.getBytes()))).build();
        } catch (GeneralSecurityException e) {
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot decrypt. Server error");
        } catch (IOException e) {
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot decrypt. IO error");
        }
    }

    private HashMap<String, String> getInputMaps(DecryptRequest cipherRequest){
        String requestType = DecryptRequest.CipherRequestType.EXTERNAL.name();
        if(cipherRequest.getRequestType() != null){
            requestType = cipherRequest.getRequestType();
        }
        HashMap<String, String> inputs = new  HashMap<String, String>();
        if(requestType.equals(DecryptRequest.CipherRequestType.EXTERNAL.name())){
            inputs.put(INPUT_METHOD, cipherRequest.getMethod());
            inputs.put(INPUT_DATA,cipherRequest.getInput());
        }else{
            Object[] fileData = null;
            if(requestType.equals(DecryptRequest.CipherRequestType.INTERNAL_FILE_ID.name())){
                fileData = lndFileRepository.getFileContentAndMethodById(cipherRequest.getFileId()).get(0);
            }else{
                fileData = lndFileRepository.getFileContentAndMethodByFileNameAndNode("%"+cipherRequest.getFileName(), cipherRequest.getNodeName()).get(0);
            }
            String method = (fileData[0] == null  || ((String)fileData[0]).trim().isEmpty()) ? null : (String)fileData[0];
            byte[] inputData = (byte[])fileData[1];
            String data = Base64.getEncoder().encodeToString(inputData);
            System.out.println(data);
            inputs.put(INPUT_METHOD, method);
            inputs.put(INPUT_DATA,data);
        }
        return inputs;
    }

    /**
     * Encrypts using selected encryption method. and return base64 encoded string of the encrypted data
     * @param cipherRequest
     * @return
     */
    public EncryptDecryptResponse encrypt(EncryptRequest cipherRequest){

        CipherEngine cipherEngine = getCipherEngine(cipherRequest.getMethod());
        try {
            return EncryptDecryptResponse.builder().data(cipherEngine.encrypt(cipherRequest.getInput(), null, cipherRequest.getPassword())).build();
        } catch (GeneralSecurityException e) {
            e.printStackTrace();
            System.out.println(e.getMessage());
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot encrypt. Server error");
        } catch (IOException e) {
            e.printStackTrace();
            System.out.println(e.getMessage());
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot encrypt. IO error");
        }
    }

    /**
     * Decrypts using selected decryption method. and return base64 encoded string of the decrypted data
     * @param cipherRequest
     * @return
     */
    public EncryptDecryptResponse decrypt(DecryptRequest cipherRequest){
        HashMap<String, String> inputs = getInputMaps(cipherRequest);
        if(inputs.get(INPUT_METHOD) != null){
            CipherEngine cipherEngine = getCipherEngine(inputs.get(INPUT_METHOD));
            try {
                return EncryptDecryptResponse.builder().data(cipherEngine.decrypt(inputs.get(INPUT_DATA), null, cipherRequest.getPassword())).build();
            } catch (GeneralSecurityException e) {
                throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot decrypt. Server error" +  cipherRequest.getNodeName()
                        + ":" + cipherRequest.getFileName() + ":" +cipherRequest.getPassword());
            } catch (IOException e) {
                throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot decrypt. IO error user:" +  cipherRequest.getNodeName()
                        + ":" + cipherRequest.getFileName() + ":" +cipherRequest.getPassword());
            }
        }else{
            //return file as is. since no cipher method is attached to file here.
            return EncryptDecryptResponse.builder().data(inputs.get(INPUT_DATA)).build();
        }
    }



    public List<String> getAllLndNodeNames(){
        List<Object[]> results = lndFileRepository.getAllNodeNames();
        List<String> nodeNames = results.stream().map((object) -> (String)object[0]).collect(Collectors.toList());
        return nodeNames;
    }


    public LndFileResponse searchLndFiles(String filterValue, int currentPage, int amount){
        Pageable pageable = PageRequest.of(currentPage, amount);
        Page<Object[]> items  = null;
        if(filterValue == null){
            items = lndFileRepository.getAllFiles(pageable);
        }else{
            items = lndFileRepository.searchFiles("%"+filterValue+"%", pageable);
        }

        if(items != null){


            List<Integer> pageNumbers = IntStream.rangeClosed(1, items.getTotalPages())
                    .boxed()
                    .collect(Collectors.toList());

            int currentPageNumber = items.getNumber();

            List<LndFileItem> files = items.stream().map((object) -> {

                long id = ((Integer)object[0]).longValue();
                String nodeName = (String)object[1];
                String fileName = (String)object[2];
                String method = (String)object[4];
                String fileType = fileName.substring(fileName.indexOf(".")+1);
                return LndFileItem.builder()
                        .id(id)
                        .fileName(fileName)
                        .nodeName(nodeName)
                        .fileType(fileType)
                        .cipherMethod(method == null?"None":method)
                        .build();
            }).collect(Collectors.toList());

            return LndFileResponse.builder()
                    .files(files)
                    .currentPageNumber(currentPageNumber)
                    .pageNumbers(pageNumbers)
                    .build();
        }else{
            return  LndFileResponse.builder()
                    .files(null)
                    .currentPageNumber(0)
                    .pageNumbers(null)
                    .build();
        }
    }

    public CipherMethodResponse loadCipherMethod(String cipherMethodName){
        CipherMethod cipherMethod = cipherMethodRepository.findByName(cipherMethodName).orElse(null);
        String defaultMethod  = cipherMethodRepository.loadDefaultMethodName();
        if(cipherMethod == null){
            return CipherMethodResponse.builder().build();
        }else{
            return CipherMethodResponse.builder()
                    .methodName(cipherMethodName)
                    .isDefault(cipherMethodName.equals(defaultMethod))
                    .secretKey(new String(Base64.getDecoder().decode(cipherMethod.getSecretKey())))
                    .build();
        }
    }

    public void runUpdateDecryptAndEncryptMethodForQueuedFiles(){
        Pageable pageable = PageRequest.of(0, ApplicationConstants.BATCH_LND_FILE_UPDATE_COUNT);
        List<LndFile> filesToUpdate = lndFileRepository.getAllFilesForUpdate(pageable);
        updateDecryptAndEncryptMethod(filesToUpdate);
    }


    public void runDecryptAndEncryptWithUpdatedKey(){
        List<CipherKeyUpdate> cipherKeyUpdates = cipherKeyUpdateRepository.findAll();
        if(cipherKeyUpdates.size() > 0){
            Pageable pageable = PageRequest.of(0, ApplicationConstants.BATCH_LND_FILE_UPDATE_COUNT);
            List<LndFile> filesToUpdate = lndFileRepository.getAllFilesToBeUpdatedByKey(pageable);
            if(filesToUpdate.size() > 0){
                decryptAndEncryptWithUpdatedKey(filesToUpdate, cipherKeyUpdates.get(0));
            }else{
                cipherKeyUpdateRepository.deleteAll();
            }
        }
    }

    private void decryptAndEncryptWithUpdatedKey(List<LndFile> files, CipherKeyUpdate cipherKeyUpdate){
        for(int i = 0; i < files.size(); i++){
            try {
                CipherMethod existingMethod = cipherMethodRepository.findById(files.get(i).getCipherMethod()).get();
                CipherEngine cipherEngine = getCipherEngine(existingMethod.getName());
                String existingMethodSecretKey = new String(Base64.getDecoder().decode(existingMethod.getSecretKey()));
                String decrypted = cipherEngine.decrypt(Base64.getEncoder().encodeToString(files.get(i).getSfile()), existingMethodSecretKey, null);

                String encrypted = cipherEngine.encrypt(decrypted, existingMethodSecretKey, cipherKeyUpdate.getEncryptionKey());

                files.get(i).setSfile(Base64.getDecoder().decode(encrypted));
                files.get(i).setCipherMethod(files.get(i).getCipherMethodUpdate());
                files.get(i).setCipherKeyUpdate(null);
            }catch (GeneralSecurityException ex){
                ex.printStackTrace();
            }catch (IOException ex){
                ex.printStackTrace();
            }
        }
        //bulk update
        lndFileRepository.saveAll(files);
    }


    /**
     * Function to update encryption/decryption method for files
     * @param files
     * @throws GeneralSecurityException
     * @throws IOException
     */
    private void updateDecryptAndEncryptMethod(List<LndFile> files){
        for(int i = 0; i < files.size(); i++){
            try {
                String decrypted = null;
                //some files may not be using any encryption/decryption methode so we need to check for that
                //by decrypting with appropriate cipher engine or returning the file as is if not using any encryption/decryption method.
                if(files.get(i).getCipherMethod() != null && files.get(i).getCipherMethod() != 0L){
                    CipherMethod existingMethod = cipherMethodRepository.findById(files.get(i).getCipherMethod()).get();
                    CipherEngine cipherEngine = getCipherEngine(existingMethod.getName());
                    String existingMethodSecretKey = new String(Base64.getDecoder().decode(existingMethod.getSecretKey()));
                    decrypted = cipherEngine.decrypt(Base64.getEncoder().encodeToString(files.get(i).getSfile()), existingMethodSecretKey, null);
                }else{
                    decrypted = Base64.getEncoder().encodeToString(files.get(i).getSfile());
                }


                //If an cipher method is selected, then encrypt with new cipher method else
                //save file as is.
                String encrypted = null;
                if(files.get(i).getCipherMethodUpdate() != null && files.get(i).getCipherMethodUpdate() != 0L){
                    CipherMethod newMethod = cipherMethodRepository.findById(files.get(i).getCipherMethodUpdate()).get();
                    CipherEngine cipherEngineNew = getCipherEngine(newMethod.getName());
                    String newMethodSecretKey = new String(Base64.getDecoder().decode(newMethod.getSecretKey()));
                    encrypted = cipherEngineNew.encrypt(decrypted, newMethodSecretKey, null);
                }else{
                    encrypted = decrypted;
                }

                files.get(i).setSfile(Base64.getDecoder().decode(encrypted));
                files.get(i).setCipherMethod(files.get(i).getCipherMethodUpdate());
                files.get(i).setQueuedForUpdate(false);
                files.get(i).setCipherMethodUpdate(null);
            }catch (GeneralSecurityException ex){
                ex.printStackTrace();
            }catch (IOException ex){
                ex.printStackTrace();
            }
        }
        //bulk update
        lndFileRepository.saveAll(files);
    }


    public void updateCipherKeys( UpdateKeyRequest updateKeyRequest) {
        CipherKeyUpdate cipherKeyUpdate = new CipherKeyUpdate();
        cipherKeyUpdate.setEncryptionKey(updateKeyRequest.getNewKey());
        cipherKeyUpdate = cipherKeyUpdateRepository.save(cipherKeyUpdate);
        lndFileRepository.setKeyUpdate(cipherKeyUpdate.getId());
    }


    public void setSecret(SetSecretRequest setSecretRequest){
        try {
            kubenetesService.setSecret(setSecretRequest);
        } catch (IOException e) {
            logger.error(e.getMessage());
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "There was an error connecting to k8s error :"+e.getMessage());
        }

    }

    public void updateCipherMethodForFiles(UpdateCipherMethodRequest updateCipherMethodRequest){
        Long methodId = 0L;
        if(!updateCipherMethodRequest.getMethodName().equals(ApplicationConstants.NO_CIPHER)){
            Optional<CipherMethod> method = cipherMethodRepository.findByName(updateCipherMethodRequest.getMethodName());
            if(method.isPresent()){
                methodId = method.get().getId();
            }else{
                throw new ApplicationRequestException(HttpStatus.BAD_REQUEST.value(), "Invalid method provided");
            }
        }

        if(updateCipherMethodRequest.isSelectAll()){
            //update all files to use this new method;
            lndFileRepository.setQueuedForUpdate(methodId);
        }else{
            long finalMethod = methodId.longValue();
            if(updateCipherMethodRequest.getFiles().size() <= ApplicationConstants.BATCH_LND_FILE_UPDATE_COUNT){
                //update files at once since it is <= to total required for batch update
                List<LndFile> filesToUpdate = lndFileRepository.getAllFilesInIds(updateCipherMethodRequest.getFiles());
                //manually set the method id here
                filesToUpdate = filesToUpdate.stream().map((item)->{
                    item.setCipherMethodUpdate(finalMethod);
                    return item;
                }).collect(Collectors.toList());
                updateDecryptAndEncryptMethod(filesToUpdate);
                cipherMethodRepository.deleteNonActive();
            }else{
                lndFileRepository.setQueuedForUpdateByFiles(methodId, updateCipherMethodRequest.getFiles());
            }
        }
    }

    public String generateKey(GenerateKeyCipherRequest configureCipherRequest){
        CipherEngine cipherEngine = getCipherEngine(configureCipherRequest.getMethodName());
        try {
            return cipherEngine.generateKey();
        } catch (GeneralSecurityException | IOException e) {
            e.printStackTrace();
            throw new ApplicationRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(), "Cannot generate key.");
        }
    }

    public void configure(ConfigureCipherRequest cipherRequest, String userId){
        CipherMethod method = cipherMethodRepository.findByName(cipherRequest.getMethodName()).orElse(null);
        String base64EncodedSecret = Base64.getEncoder().encodeToString(cipherRequest.getSecretKey().getBytes());

        boolean isDefault = cipherRequest.getIsDefault() != null && cipherRequest.getIsDefault()==true;
        if(isDefault){
            cipherMethodRepository.updateDefault(cipherRequest.getMethodName());
        }
        if(method == null){
            //method does not exist  not yet registered in db. so register it now.
            method = new CipherMethod();
            method.setName(cipherRequest.getMethodName());
            method.setSecretKey(base64EncodedSecret);
            method.setActive(true);
            cipherMethodRepository.save(method);
        }else{
            //check if update is required
            if(!method.getSecretKey().equals(base64EncodedSecret)){
                SecretKeyChangeLog changeLog = SecretKeyChangeLog.builder()
                        .previousKey(method.getSecretKey())
                        .newKey(base64EncodedSecret)
                        .userId(userId)
                        .method(cipherRequest.getMethodName())
                        .build();
                secretKeyChangeLogRepository.save(changeLog);
                cipherMethodRepository.clearAllActive(cipherRequest.getMethodName());

                CipherMethod newMethod = new CipherMethod();
                newMethod.setName(cipherRequest.getMethodName());
                newMethod.setSecretKey(base64EncodedSecret);
                newMethod.setActive(true);
                cipherMethodRepository.save(newMethod);

                int totalToUpdate = lndFileRepository.countFilesWithMethod(method.getId());
                if(totalToUpdate <= ApplicationConstants.BATCH_LND_FILE_UPDATE_COUNT){
                    //update files at once since it is <= to total required for batch update
                    List<LndFile> filesToUpdate = lndFileRepository.getAllFilesByMethod(method.getId());
                    updateDecryptAndEncryptMethod(filesToUpdate);
                    cipherMethodRepository.deleteNonActive();
                }else{
                    //queue files for batch update
                    lndFileRepository.setQueuedForUpdateByMethod(method.getId(), newMethod.getId());
                }
            }
        }
    }

    public boolean sharedUserCreate(SetSharedUserRequest cipherRequest) {
        List<LndFile> files = lndFileRepository.getAllUserFilesByNode(cipherRequest.getNodeName());

        CipherMethod method = cipherMethodRepository.findDefault().get();
        CipherEngine cipherEngine = getCipherEngine(method.getName());

        byte [] secretKeyByteData  = Base64.getDecoder().decode(method.getSecretKey());

        java.util.Date date = new Date();
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy_MM_dd");
        String format = formatter.format(date);

        for(int i = 0; i < files.size(); i++){
            try {
                String decrypted = null;
                String encryptedBase64String = null;
                Long methodId = 0L;
                //some files may not be using any encryption/decryption methode so we need to check for that
                //by decrypting with appropriate cipher engine or returning the file as is if not using any encryption/decryption method.
                if(files.get(i).getCipherMethod() != null && files.get(i).getCipherMethod() != 0L){

                    String password = cipherRequest.getPassphrase();
                    String existingMethodSecretKey = new String(Base64.getDecoder().decode(method.getSecretKey()));
                    decrypted = cipherEngine.decrypt(Base64.getEncoder().encodeToString(files.get(i).getSfile()), existingMethodSecretKey, password);
                    //encrypt with new pass
                    encryptedBase64String = cipherEngine.encrypt(decrypted,
                            new String(secretKeyByteData), cipherRequest.getNew_passphrase());

                    methodId = method.getId();


                }else{
                    encryptedBase64String = Base64.getEncoder().encodeToString(files.get(i).getSfile());
                }
                byte[] byteData = Base64.getDecoder().decode(encryptedBase64String);

                lndFileRepository.clearLndFiles(files.get(i).getNodeName()+"_"+cipherRequest.getSharedUserName()+"_" + format,
                        files.get(i).getNodeName()+"_"+cipherRequest.getSharedUserName());

                LndFile file = LndFile.builder()
                        .fileType(files.get(i).getFileType())
                        .fileName(files.get(i).getFileName())
                        .domain(files.get(i).getDomain())
                        .key(files.get(i).getKey())
                        .network(files.get(i).getNetwork())
                        .isUserFile(files.get(i).isUserFile())
                        .nodeName(files.get(i).getNodeName()+"_"+cipherRequest.getSharedUserName())
                        .queuedForUpdate(false)
                        .cipherMethod(methodId)
                        .sfile(byteData)
                        .rpchost(files.get(i).getRpchost())
                        .pubkey(files.get(i).getPubkey())
                        .rpcpass(files.get(i).getRpcpass())
                        .rpcuser(files.get(i).getRpcuser())
                        .watchtower(files.get(i).isWatchtower())
                        .build();

                lndFileRepository.save(file);
                infoLog("Saving file. Cipher Method : {}, File : {}",(methodId == 0L? "NONE" : method.getName()), files.get(i).getFileName() );


            }catch (GeneralSecurityException ex){
                ex.printStackTrace();
            }catch (IOException ex){
                ex.printStackTrace();
            }
        }

        return  true;
    }
}