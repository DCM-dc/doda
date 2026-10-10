#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    CFStringRef account = CFStringCreateWithCString(NULL, argv[2], kCFStringEncodingUTF8);
    if (!account) return 2;
    const void *keys[] = { kSecClass, kSecAttrService, kSecAttrAccount };
    const void *values[] = { kSecClassGenericPassword, CFSTR("local.doda.desktop.credentials"), account };
    CFMutableDictionaryRef query = CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    for (int i = 0; i < 3; i++) CFDictionarySetValue(query, keys[i], values[i]);
    OSStatus status;
    if (!strcmp(argv[1], "read")) {
        CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
        CFTypeRef result = NULL;
        status = SecItemCopyMatching(query, &result);
        if (status == errSecItemNotFound) { fputs("{}", stdout); status = errSecSuccess; }
        else if (status == errSecSuccess && result && CFGetTypeID(result) == CFDataGetTypeID()) fwrite(CFDataGetBytePtr(result), 1, CFDataGetLength(result), stdout);
        else if (status == errSecSuccess) status = errSecDecode;
        if (result) CFRelease(result);
    } else if (!strcmp(argv[1], "write")) {
        unsigned char buffer[4097];
        size_t length = fread(buffer, 1, sizeof(buffer), stdin);
        if (!length || length == sizeof(buffer) || ferror(stdin)) return 2;
        CFDataRef data = CFDataCreate(NULL, buffer, length);
        CFDictionarySetValue(query, kSecValueData, data);
        status = SecItemAdd(query, NULL);
        if (status == errSecDuplicateItem) {
            CFDictionaryRemoveValue(query, kSecValueData);
            const void *updateKeys[] = { kSecValueData };
            const void *updateValues[] = { data };
            CFDictionaryRef update = CFDictionaryCreate(NULL, updateKeys, updateValues, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
            status = SecItemUpdate(query, update);
            CFRelease(update);
        }
        memset(buffer, 0, sizeof(buffer));
        CFRelease(data);
    } else if (!strcmp(argv[1], "erase")) {
        status = SecItemDelete(query);
        if (status == errSecItemNotFound) status = errSecSuccess;
    } else return 2;
    CFRelease(query);
    CFRelease(account);
    return status == errSecSuccess ? 0 : 1;
}
