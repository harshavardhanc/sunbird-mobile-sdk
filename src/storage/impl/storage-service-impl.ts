import {
    StorageDestination,
    StorageEventType,
    StorageService,
    StorageTransferCompleted,
    StorageTransferFailed,
    StorageTransferFailedDuplicateContent,
    StorageTransferRevertCompleted,
    TransferContentsRequest,
    TransferFailedDuplicateContentError,
    TransferFailedError
} from '..';
import {BehaviorSubject, Observable, Subscription} from 'rxjs';
import {Content} from '../../content';
import {inject, injectable} from 'inversify';
import {EventNamespace, EventsBusService} from '../../events-bus';
import {InjectionTokens} from '../../injection-tokens';
import {StorageKeys} from '../../preference-keys';
import {SharedPreferences} from '../../util/shared-preferences';
import {SharedPreferencesSetCollection} from '../../util/shared-preferences/def/shared-preferences-set-collection';
import {SharedPreferencesSetCollectionImpl} from '../../util/shared-preferences/impl/shared-preferences-set-collection-impl';
import {DbService} from '../../db';
import {ContentEntry} from '../../content/db/schema';
import {ContentMapper} from '../../content/util/content-mapper';
import {TransferContentHandler} from '../handler/transfer-content-handler';
import {DeviceInfo, StorageVolume} from '../../util/device';

@injectable()
export class StorageServiceImpl implements StorageService {
    private static readonly STORAGE_DESTINATION = StorageKeys.KEY_STORAGE_DESTINATION;
    private transferringContent$?: BehaviorSubject<Content | undefined>;
    private contentsToTransfer: SharedPreferencesSetCollection<Content>;
    private transferContentsSubscription?: Subscription;

    constructor(@inject(InjectionTokens.EVENTS_BUS_SERVICE) private eventsBusService: EventsBusService,
                @inject(InjectionTokens.SHARED_PREFERENCES) private sharedPreferences: SharedPreferences,
                @inject(InjectionTokens.DB_SERVICE) private dbService: DbService,
                @inject(InjectionTokens.DEVICE_INFO) private deviceInfo: DeviceInfo) {
        this.contentsToTransfer = new SharedPreferencesSetCollectionImpl(
            this.sharedPreferences,
            StorageKeys.KEY_TO_TRANSFER_LIST,
            (item: Content) => item.identifier
        );
    }

    onInit(): Observable<undefined> {
        return this.cancelTransfer();
    }

    getStorageDestinationVolumeInfo(): Observable<StorageVolume> {
        return Observable.zip(
            this.getStorageDestination(),
            this.deviceInfo.getStorageVolumes()
        ).map((results) => {
            return (results[1].find((volume) => volume.storageDestination === results[0]))!;
        });
    }

    getStorageDestination(): Observable<StorageDestination> {
        return this.sharedPreferences.getString(StorageServiceImpl.STORAGE_DESTINATION)
            .map((r) => {
                if (!r) {
                    return StorageDestination.INTERNAL_STORAGE;
                }

                return r as StorageDestination;
            });
    }

    getToTransferContents(): Observable<Content[]> {
        return this.contentsToTransfer.asListChanges();
    }

    getTransferringContent(): Observable<Content | undefined> {
        if (!this.transferringContent$) {
            return Observable.of(undefined);
        }

        return this.transferringContent$.asObservable().take(1);
    }

    transferContents(transferContentsRequest: TransferContentsRequest): Observable<undefined> {
        this.transferringContent$ = new BehaviorSubject<Content | undefined>(undefined);

        if (this.transferContentsSubscription) {
            this.transferContentsSubscription.unsubscribe();
            this.transferContentsSubscription = undefined;
        }

        return Observable.of(transferContentsRequest)
            .mergeMap((request) => this.getContentsToTransfer(request))
            .mergeMap((contents) => this.addContentsToTransferQueue(contents))
            .mergeMap(() => this.switchToNextContent())
            .do(() => {
                this.transferContentsSubscription = this.transferringContent$!
                    .mergeMap((content?: Content) => {
                        if (content) {
                            return new TransferContentHandler().handle(
                                transferContentsRequest.storageDestination,
                                content,
                                this.eventsBusService
                            ).concatMap(() => this.switchToNextContent());
                        }

                        return Observable.of(undefined);
                    })
                    .catch((e) => {
                        if (e instanceof TransferFailedDuplicateContentError) {
                            this.eventsBusService.emit({
                                namespace: EventNamespace.STORAGE,
                                event: {
                                    type: StorageEventType.TRANSFER_FAILED_DUPLICATE_CONTENT,
                                } as StorageTransferFailedDuplicateContent
                            });
                        } else if (e instanceof TransferFailedError) {
                            this.eventsBusService.emit({
                                namespace: EventNamespace.STORAGE,
                                event: {
                                    type: StorageEventType.TRANSFER_FAILED,
                                    payload: e.message,
                                } as StorageTransferFailed
                            });
                        } else {
                            this.eventsBusService.emit({
                                namespace: EventNamespace.STORAGE,
                                event: {
                                    type: StorageEventType.TRANSFER_FAILED,
                                    payload: e,
                                } as StorageTransferFailed
                            });
                        }

                        console.error(e);
                        return this.pauseTransferContent();
                    })
                    .finally(() => {
                        this.eventsBusService.emit({
                            namespace: EventNamespace.STORAGE,
                            event: {
                                type: StorageEventType.TRANSFER_COMPLETED,
                            } as StorageTransferCompleted
                        });

                        if (this.transferContentsSubscription) {
                            this.transferContentsSubscription.unsubscribe();
                            this.transferContentsSubscription = undefined;
                        }
                    })
                    .subscribe();
            })
            .mapTo(undefined);
    }

    cancelTransfer(): Observable<undefined> {
        return this.pauseTransferContent()
            .mergeMap(() => Observable.zip(
                this.deleteTempDirectories(),
                this.clearTransferQueue()
            ))
            .mapTo(undefined)
            .do(() => this.eventsBusService.emit({
                namespace: EventNamespace.STORAGE,
                event: {
                    type: StorageEventType.TRANSFER_REVERT_COMPLETED,
                } as StorageTransferRevertCompleted
            }))
            .mergeMap(() => this.endTransfer());
    }

    retryCurrentTransfer(): Observable<undefined> {
        return this.switchToNextContent();
    }


    private deleteTempDirectories(): Observable<undefined> {
        // TODO: Swayangjit
        return Observable.of(undefined);
    }

    private getContentsToTransfer(transferContentsRequest: TransferContentsRequest): Observable<Content[]> {
        if (!!transferContentsRequest.contents.length) {
            return Observable.of(transferContentsRequest.contents);
        }

        return this.dbService
            .read({table: ContentEntry.TABLE_NAME})
            .map((contentEntries) => contentEntries.map(ContentMapper.mapContentDBEntryToContent));
    }

    private addContentsToTransferQueue(contents: Content[]): Observable<undefined> {
        return this.contentsToTransfer.addAll(contents).mapTo(undefined);
    }

    private switchToNextContent(): Observable<undefined> {
        return this.getTransferringContent()
            .mergeMap((content?: Content) => {
                if (content) {
                    return this.contentsToTransfer.remove(content).mapTo(undefined);
                }

                return Observable.of(undefined);
            })
            .mergeMap(() => {
                return this.contentsToTransfer.asList()
                    .do((contents) => {
                        if (contents.length) {
                            return this.transferringContent$!.next(contents[0]);
                        }

                        this.getStorageDestination()
                            .mergeMap((storageDestination) => {
                                const newStorageDestination = storageDestination === StorageDestination.INTERNAL_STORAGE ?
                                    StorageDestination.EXTERNAL_STORAGE : StorageDestination.INTERNAL_STORAGE;
                                return this.sharedPreferences.putString(StorageServiceImpl.STORAGE_DESTINATION, newStorageDestination);
                            })
                            .mergeMap(() => this.endTransfer()).toPromise();
                    }).mapTo(undefined);
            });
    }

    private pauseTransferContent(): Observable<undefined> {
        if (!this.transferringContent$) {
            return Observable.of(undefined);
        }

        return Observable.defer(() => this.transferringContent$!.next(undefined));
    }

    private clearTransferQueue(): Observable<undefined> {
        return this.contentsToTransfer.clear().mapTo(undefined);
    }

    private endTransfer(): Observable<undefined> {
        if (!this.transferringContent$) {
            return Observable.of(undefined);
        }

        return Observable.defer(() => this.transferringContent$!.complete());
    }
}
